"""Payment endpoints - Click Uz, Payme, and manual card top-up."""
import asyncio
import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from aiohttp import web
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app import config
from app.api.drivers import require_driver
from app.database import get_session
from app.models import BalanceTransaction, Driver, Payment

logger = logging.getLogger(__name__)

# Payment receipts are identity/financial documents and must never be public uploads.
TOPUP_UPLOAD_DIR = Path(config.UPLOAD_DIR) / "private" / "receipts"
TOPUP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
try:
    TOPUP_UPLOAD_DIR.chmod(0o700)
except OSError:
    pass
TOPUP_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
TOPUP_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
# How many un-reviewed manual top-ups one driver may have open at a time. Stops an upload
# loop from filling the receipts directory and spamming the admin chat.
MAX_PENDING_TOPUPS_PER_DRIVER = 3


def _delete_pending_payment_artifacts(payment_id: int, file_path: Path) -> bool:
    """Atomically delete an unreviewable pending payment and its local receipt.

    Approval and cleanup both require ``status='pending'``. Only the transaction that
    changes/deletes that row may remove the receipt, so an ambiguous Telegram timeout
    can never destroy evidence for a payment that approval already claimed.
    """
    session = get_session()
    try:
        deleted = session.query(Payment).filter_by(
            id=payment_id, status="pending"
        ).delete(synchronize_session=False)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    if deleted == 1:
        file_path.unlink(missing_ok=True)
        return True
    return False


def credit_driver_payment(session, payment: Payment):
    """Atomically approve one pending payment and credit its driver exactly once.

    The pending -> processing conditional update is the idempotency gate. If another
    callback already claimed the row this returns ``None`` without changing money.
    Driver balance, one-time bonus flag, payment status, and immutable ledger row are
    committed by the caller as one transaction.
    """
    payment_id = payment.id
    if not payment_id:
        return None

    # NOTE on transaction ownership: this helper does NOT own `session`, so it must not
    # roll it back. It used to call session.rollback() on the "already claimed" and
    # "payment vanished" paths, actively discarding anything the CALLER had written earlier
    # in the same transaction — a side effect no caller can see coming from a function whose
    # contract is "returns None when nothing was credited". Returning None is sufficient:
    # every caller treats a falsy return as "nothing happened" and does not commit, so the
    # claim above is simply never persisted.
    claimed = (
        session.query(Payment)
        .filter(Payment.id == payment_id, Payment.status == "pending")
        .update({Payment.status: "processing"}, synchronize_session=False)
    )
    if claimed != 1:
        return None

    payment = session.query(Payment).filter_by(id=payment_id).first()
    if not payment:
        return None

    driver = session.query(Driver).filter_by(id=payment.driver_id).first()
    if not driver:
        # No driver to credit: reject the payment and persist that terminal state here,
        # because callers treat a falsy return as "nothing was credited" and do not
        # commit. Returning a truthy tuple made them log a `payment.approve` audit row
        # and report success for a top-up that never produced a ledger entry.
        payment.status = "rejected"
        payment.processed_at = datetime.utcnow()
        session.commit()
        return None

    # Atomically claim the driver's one-time first-top-up bonus. This is safe even if
    # two different payment approvals for the same driver arrive concurrently.
    bonus_claimed = (
        session.query(Driver)
        .filter(
            Driver.id == driver.id,
            Driver.first_payment_bonus_granted == False,  # noqa: E712
        )
        .update(
            {Driver.first_payment_bonus_granted: True},
            synchronize_session=False,
        )
    )
    bonus = int(payment.amount * 0.5) if bonus_claimed == 1 else 0
    total = payment.amount + bonus

    session.query(Driver).filter(Driver.id == driver.id).update(
        {Driver.balance: func.coalesce(Driver.balance, 0) + total},
        synchronize_session=False,
    )
    session.flush()
    session.refresh(driver)

    payment.status = "approved"
    payment.bonus_amount = bonus
    payment.processed_at = datetime.utcnow()
    session.add(BalanceTransaction(
        driver_id=driver.id,
        amount=total,
        balance_after=driver.balance or 0,
        source="topup",
        reference_type="payment",
        reference_id=payment.id,
        idempotency_key=f"payment:{payment.id}:approved",
        note=f"{payment.provider} top-up; principal={payment.amount}; bonus={bonus}",
    ))
    return payment.amount, bonus, driver


def _verify_click_signature(data: dict, action: str) -> bool:
    """Verify Click Uz signature.
    Click sends sign_string which is MD5 of:
    click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time
    For complete: + merchant_prepare_id between merchant_trans_id and amount.
    """
    if not (config.CLICK_ENABLED and config.CLICK_SECRET_KEY):
        return False

    sign_string = data.get("sign_string", "")
    if not sign_string:
        return False

    parts = [
        str(data.get("click_trans_id", "")),
        str(data.get("service_id", "")),
        config.CLICK_SECRET_KEY,
        str(data.get("merchant_trans_id", "")),
    ]

    if action == "1":  # complete
        parts.append(str(data.get("merchant_prepare_id", "")))

    parts.append(str(data.get("amount", "")))
    parts.append(str(data.get("action", "")))
    parts.append(str(data.get("sign_time", "")))

    expected = hashlib.md5("".join(parts).encode()).hexdigest()
    return hmac.compare_digest(expected.lower(), sign_string.lower())


# ============= AVAILABLE PAYMENT METHODS =============

async def list_methods(request: web.Request) -> web.Response:
    """GET /api/payments/methods - list available top-up methods."""
    methods = []

    # Manual card — only offered when a top-up card number is configured (via env).
    if config.TOPUP_CARD_NUMBER:
        methods.append({
            "id": "card",
            "name": "Karta orqali",
            "icon": "💳",
            "description": "Kartaga to'lab, chekni ilovada yuklaysiz",
            "card_number": config.TOPUP_CARD_NUMBER,
            "card_holder": config.TOPUP_CARD_HOLDER,
            "instant": False,
        })

    # Automated providers are deliberately disabled until their merchant flows are
    # completed and certified. Manual card transfer is the only active method.
    methods.append({
        "id": "click",
        "name": "Click Uz",
        "icon": "💙",
        "description": "Tez orada qo'shiladi",
        "instant": True,
        "disabled": True,
    })

    # Payme is intentionally unavailable until its full merchant state machine is
    # implemented and certified. Never advertise a partial money flow.
    methods.append({
        "id": "payme",
        "name": "Payme",
        "icon": "💚",
        "description": "Tez orada qo'shiladi",
        "instant": True,
        "disabled": True,
    })

    return web.json_response({"methods": methods})


# ============= CLICK UZ =============

@require_driver
async def create_click_payment(request: web.Request) -> web.Response:
    """POST /api/payments/click/create
    Body: {"amount": 50000}
    Returns: {"url": "https://my.click.uz/services/pay?..."}
    """
    driver: Driver = request["driver"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    amount = int(data.get("amount", 0))
    if amount < config.TOPUP_MIN_AMOUNT or amount > config.TOPUP_MAX_AMOUNT:
        return web.json_response(
            {
                "error": (
                    f"Summa {config.TOPUP_MIN_AMOUNT} dan "
                    f"{config.TOPUP_MAX_AMOUNT} so'mgacha bo'lishi kerak"
                )
            },
            status=400,
        )

    if not (
        config.CLICK_ENABLED
        and config.CLICK_MERCHANT_ID
        and config.CLICK_SERVICE_ID
        and config.CLICK_SECRET_KEY
    ):
        return web.json_response({
            "error": "Click Uz hozircha mavjud emas. Karta orqali to'ldiring",
        }, status=503)

    # Create pending payment record
    session = get_session()
    try:
        payment = Payment(
            driver_id=driver.id,
            provider="click",
            amount=amount,
            status="pending",
        )
        session.add(payment)
        session.commit()
        session.refresh(payment)
        payment_id = payment.id
    finally:
        session.close()

    # Click Uz redirect URL format
    # Docs: https://docs.click.uz/click-api/
    params = {
        "service_id": config.CLICK_SERVICE_ID,
        "merchant_id": config.CLICK_MERCHANT_ID,
        "amount": amount,
        "transaction_param": payment_id,  # our internal payment ID
        "return_url": f"sarixgodriver://payment-result?id={payment_id}",
    }
    url = f"https://my.click.uz/services/pay?{urlencode(params)}"

    return web.json_response({
        "payment_id": payment_id,
        "url": url,
        "amount": amount,
    })


async def click_prepare(request: web.Request) -> web.Response:
    """POST /api/payments/click/prepare
    Webhook called by Click Uz to validate transaction.
    Docs: https://docs.click.uz/
    """
    try:
        data = await request.post()
    except Exception:
        return web.json_response({"error": -8, "error_note": "Invalid request"})

    data_dict = dict(data)

    # Verify signature
    if not _verify_click_signature(data_dict, "0"):
        logger.warning("Click prepare: invalid signature")
        return web.json_response({"error": -1, "error_note": "Invalid signature"})

    transaction_param = data.get("merchant_trans_id")

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(
            id=int(transaction_param), provider="click"
        ).first()
        if not payment:
            return web.json_response({"error": -5, "error_note": "Transaction not found"})
        try:
            requested_amount = int(float(data.get("amount", 0)))
        except (TypeError, ValueError):
            requested_amount = 0
        if payment.amount != requested_amount or payment.status not in {"pending", "approved"}:
            return web.json_response({"error": -2, "error_note": "Invalid payment state"})

        return web.json_response({
            "click_trans_id": data.get("click_trans_id"),
            "merchant_trans_id": transaction_param,
            "merchant_prepare_id": payment.id,
            "error": 0,
            "error_note": "Success",
        })
    finally:
        session.close()


async def click_complete(request: web.Request) -> web.Response:
    """POST /api/payments/click/complete
    Webhook called by Click Uz when payment completes.
    """
    try:
        data = await request.post()
    except Exception:
        return web.json_response({"error": -8, "error_note": "Invalid request"})

    data_dict = dict(data)

    # Verify signature
    if not _verify_click_signature(data_dict, "1"):
        logger.warning("Click complete: invalid signature")
        return web.json_response({"error": -1, "error_note": "Invalid signature"})

    transaction_param = data.get("merchant_trans_id")
    # Provider input is untrusted: an unguarded int() on either of these raised ValueError
    # and turned malformed callback data into a 500 instead of a protocol-level error.
    try:
        error_code = int(data.get("error", -1))
    except (TypeError, ValueError):
        return web.json_response({"error": -8, "error_note": "Invalid error code"})
    try:
        payment_pk = int(transaction_param)
    except (TypeError, ValueError):
        return web.json_response({"error": -5, "error_note": "Transaction not found"})

    incoming_trans_id = str(data.get("click_trans_id", "")).strip()

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(
            id=payment_pk, provider="click"
        ).first()
        if not payment:
            return web.json_response({"error": -5, "error_note": "Transaction not found"})

        if payment.status == "approved":
            # Only report success for a REPLAY of the transaction we actually credited.
            #
            # This branch used to answer "Already processed / error: 0" for any callback on
            # an approved payment, without comparing click_trans_id. A genuinely different
            # Click transaction pointing at the same merchant_trans_id was therefore booked
            # as settled by the provider while the driver was credited only once — money
            # taken from the rider, never delivered.
            if incoming_trans_id and payment.provider_transaction_id and (
                incoming_trans_id != payment.provider_transaction_id
            ):
                logger.warning(
                    "Click complete: trans_id mismatch for payment %s (stored=%s incoming=%s)",
                    payment.id, payment.provider_transaction_id, incoming_trans_id,
                )
                return web.json_response(
                    {"error": -3, "error_note": "Duplicate transaction"}
                )
            return web.json_response({
                "click_trans_id": data.get("click_trans_id"),
                "merchant_trans_id": transaction_param,
                "merchant_confirm_id": payment.id,
                "error": 0,
                "error_note": "Already processed",
            })

        if error_code == 0:
            try:
                requested_amount = int(float(data.get("amount", 0)))
            except (TypeError, ValueError):
                requested_amount = 0
            if requested_amount != payment.amount:
                return web.json_response({"error": -2, "error_note": "Wrong amount"})

            click_transaction_id = incoming_trans_id
            duplicate = session.query(Payment).filter(
                Payment.provider == "click",
                Payment.provider_transaction_id == click_transaction_id,
                Payment.id != payment.id,
            ).first()
            if not click_transaction_id or duplicate:
                return web.json_response({"error": -3, "error_note": "Duplicate transaction"})
            payment.provider_transaction_id = click_transaction_id
            credited = credit_driver_payment(session, payment)
            if not credited:
                return web.json_response({"error": -4, "error_note": "Already processing"})
            session.commit()

            return web.json_response({
                "click_trans_id": data.get("click_trans_id"),
                "merchant_trans_id": transaction_param,
                "merchant_confirm_id": payment.id,
                "error": 0,
                "error_note": "Success",
            })
        else:
            claimed = session.query(Payment).filter_by(
                id=payment.id, provider="click", status="pending"
            ).update(
                {"status": "rejected", "processed_at": datetime.utcnow()},
                synchronize_session=False,
            )
            if claimed:
                session.commit()
            return web.json_response({
                "error": error_code,
                "error_note": "Cancelled",
            })
    finally:
        session.close()


# ============= PAYME =============

async def create_payme_payment(request: web.Request) -> web.Response:
    """Fail closed: Payme is not part of the active production payment flow."""
    return web.json_response(
        {"error": "Payme integratsiyasi hozircha o'chirilgan"}, status=503
    )


async def payme_webhook(request: web.Request) -> web.Response:
    """Fail closed instead of exposing an incomplete merchant state machine."""
    return web.json_response(
        {"error": {"code": -32504, "message": "Payme integration disabled"}},
        status=503,
    )


# ============= PAYMENT STATUS =============

@require_driver
async def get_payment_status(request: web.Request) -> web.Response:
    """GET /api/payments/{id}/status"""
    driver: Driver = request["driver"]
    payment_id = int(request.match_info["id"])

    session = get_session()
    try:
        payment = (
            session.query(Payment)
            .filter_by(id=payment_id, driver_id=driver.id)
            .first()
        )
        if not payment:
            return web.json_response({"error": "Payment not found"}, status=404)

        return web.json_response({
            "id": payment.id,
            "amount": payment.amount,
            "bonus_amount": payment.bonus_amount,
            "status": payment.status,
            "created_at": payment.created_at.isoformat() if payment.created_at else None,
            "processed_at": payment.processed_at.isoformat() if payment.processed_at else None,
        })
    finally:
        session.close()



@require_driver
async def get_payment_receipt(request: web.Request) -> web.Response:
    """Serve a manual-app receipt only to the driver who submitted it."""
    driver: Driver = request["driver"]
    try:
        payment_id = int(request.match_info["id"])
    except (KeyError, ValueError):
        return web.json_response({"error": "Noto'g'ri payment ID"}, status=400)
    session = get_session()
    try:
        payment = session.query(Payment).filter_by(
            id=payment_id, driver_id=driver.id, provider="manual_app"
        ).first()
        stored_path = payment.photo_file_id if payment else None
    finally:
        session.close()
    from app.api.uploads import resolve_upload_path
    path = resolve_upload_path(stored_path)
    if not path or not path.exists() or not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path, headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


def cleanup_expired_pending_payments(now: datetime | None = None) -> int:
    """Cancel stale manual requests and delete locally stored receipt images."""
    now = now or datetime.utcnow()
    cutoff = now - timedelta(hours=max(1, config.TOPUP_PENDING_HOURS))
    session = get_session()
    # Atomically claim every still-pending stale row. Approval uses the inverse
    # pending -> processing guard, so exactly one side can win and only cleanup-owned
    # receipts are deleted after commit.
    try:
        claimed = session.query(Payment).filter(
            Payment.provider.in_(["manual_app", "manual_bot"]),
            Payment.status == "pending",
            Payment.created_at <= cutoff,
        ).update(
            {Payment.status: "cancelled", Payment.processed_at: now},
            synchronize_session=False,
        )
        claimed_payments = session.query(Payment).filter(
            Payment.provider == "manual_app",
            Payment.status == "cancelled",
            Payment.processed_at == now,
            Payment.photo_file_id.isnot(None),
        ).all()
        local_paths = [payment.photo_file_id for payment in claimed_payments]
        session.commit()
        count = int(claimed or 0)
    except Exception:
        session.rollback()
        logger.exception("Could not clean up expired pending payments")
        return 0
    finally:
        session.close()

    from app.api.uploads import resolve_upload_path
    for stored_path in local_paths:
        path = resolve_upload_path(stored_path)
        if path:
            path.unlink(missing_ok=True)
    return count


async def payment_cleanup_loop() -> None:
    """Periodically expire unreviewed manual payments."""
    while True:
        await asyncio.to_thread(cleanup_expired_pending_payments)
        await asyncio.sleep(3600)


def start_payment_cleanup_scheduler() -> asyncio.Task:
    return asyncio.create_task(payment_cleanup_loop())


# ============= IN-APP MANUAL TOP-UP (card + screenshot + admin approval) =============

# Distinct callback prefixes for the IN-APP top-up approval buttons. These MUST NOT
# collide with the bot's own manual top-up handlers (tasdiq_/rad_), which credit the
# legacy JSON `balanslar` dict. The in-app flow instead credits the DB Driver.balance.
APP_TOPUP_OK_PREFIX = "apppay_ok_"
APP_TOPUP_NO_PREFIX = "apppay_no_"


@require_driver
async def topup_with_screenshot(request: web.Request) -> web.Response:
    """POST /api/driver/payments/topup

    Multipart form-data:
      - amount: integer (so'm)
      - file:   the payment screenshot image

    Mirrors the Telegram bot manual flow inside the app:
      1. Save the screenshot.
      2. Create a pending Payment row.
      3. Send the screenshot to ADMIN_ID via the bot with Approve/Reject inline buttons
         (callback_data uses the distinct `apppay_ok_<id>` / `apppay_no_<id>` prefix).
      4. Admin approval credits the DB Driver.balance (see app_topup_callback in main.py).
    """
    driver: Driver = request["driver"]

    # A blocked driver has no business topping up, and every other money/order entry point
    # already refuses them — this handler had no such check.
    # Every rejection below carries a machine-readable "code" alongside the Uzbek "error".
    # The apps show the server's text verbatim when they don't recognise the code, which
    # meant a Russian or English driver hit an Uzbek-only wall on the money path. The code
    # lets the client pick its own translated message and keep the text as the fallback.
    if driver.is_blocked:
        return web.json_response(
            {
                "error": "Hisobingiz bloklangan. Administrator bilan bog'laning.",
                "code": "driver_blocked",
            },
            status=403,
        )

    if not request.content_type or "multipart/form-data" not in request.content_type:
        return web.json_response(
            {"error": "multipart/form-data kerak (amount + file)"}, status=400
        )

    amount = 0
    file_bytes = b""
    file_ext = ".jpg"

    try:
        reader = await request.multipart()
        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "amount":
                raw = (await field.text()).strip()
                try:
                    amount = int(float(raw.replace(" ", "")))
                except (TypeError, ValueError):
                    amount = 0
            elif field.name == "file":
                filename = field.filename or "screenshot.jpg"
                ext = os.path.splitext(filename)[1].lower()
                if ext in TOPUP_ALLOWED_EXTENSIONS:
                    file_ext = ext
                size = 0
                chunks = []
                while True:
                    chunk = await field.read_chunk()
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > TOPUP_MAX_FILE_SIZE:
                        return web.json_response(
                            {"error": "Fayl juda katta (max 5MB)"}, status=413
                        )
                    chunks.append(chunk)
                file_bytes = b"".join(chunks)
    except Exception as e:
        logger.exception(f"topup multipart parse error: {e}")
        return web.json_response({"error": "Faylni o'qishda xatolik"}, status=400)

    if amount < config.TOPUP_MIN_AMOUNT or amount > config.TOPUP_MAX_AMOUNT:
        return web.json_response(
            {
                "error": (
                    f"Summa {config.TOPUP_MIN_AMOUNT} dan "
                    f"{config.TOPUP_MAX_AMOUNT} so'mgacha bo'lishi kerak"
                ),
                "code": "amount_out_of_range",
                # Sent so the app can render the bounds in the driver's own language
                # instead of falling back to the Uzbek sentence above.
                "min_amount": config.TOPUP_MIN_AMOUNT,
                "max_amount": config.TOPUP_MAX_AMOUNT,
            },
            status=400,
        )
    if not file_bytes:
        return web.json_response({"error": "To'lov skrinshotini yuklang"}, status=400)
    from app.api.uploads import detect_image_extension
    trusted_extension = detect_image_extension(file_bytes)
    if not trusted_extension:
        return web.json_response(
            {"error": "Faqat haqiqiy JPG, PNG yoki WEBP rasm qabul qilinadi"},
            status=400,
        )
    file_ext = trusted_extension

    receipt_sha256 = hashlib.sha256(file_bytes).hexdigest()
    session = get_session()
    try:
        # Cap concurrent pending requests per driver. Without this a driver could loop
        # uploads — each re-encode yields a different sha256, so the duplicate check below
        # does not stop it — filling the private receipts directory with 5 MB files and
        # flooding the admin chat. The hourly reaper only runs after TOPUP_PENDING_HOURS.
        pending_count = (
            session.query(Payment)
            .filter_by(driver_id=driver.id, provider="manual_app", status="pending")
            .count()
        )
        if pending_count >= MAX_PENDING_TOPUPS_PER_DRIVER:
            return web.json_response(
                {
                    "error": (
                        "Sizda tasdiqlanmagan to'lov so'rovi bor. "
                        "Administrator tasdiqlashini kuting."
                    ),
                    "code": "too_many_pending",
                },
                status=429,
            )

        duplicate = (
            session.query(Payment)
            .filter_by(receipt_sha256=receipt_sha256)
            # Only a LIVE submission blocks a resubmission. Matching every row meant a
            # driver whose request expired (cancelled by the reaper) or was rejected could
            # never send that screenshot again — a permanent 409 for a legitimate receipt.
            .filter(Payment.status.in_(["pending", "processing", "approved"]))
            .first()
        )
        if duplicate:
            return web.json_response(
                {"error": "Bu to'lov cheki avval yuborilgan", "code": "duplicate_receipt"},
                status=409,
            )
    finally:
        session.close()

    # Save the screenshot to disk.
    new_filename = f"topup_{driver.id}_{uuid.uuid4().hex[:8]}{file_ext}"
    file_path = TOPUP_UPLOAD_DIR / new_filename
    try:
        with open(file_path, "xb") as f:
            f.write(file_bytes)
        try:
            file_path.chmod(0o600)
        except OSError:
            pass
    except Exception as e:
        logger.exception(f"topup save error: {e}")
        return web.json_response({"error": "Faylni saqlashda xatolik"}, status=500)

    stored_path = f"private/receipts/{new_filename}"

    # Create a pending payment row.
    session = get_session()
    try:
        payment = Payment(
            driver_id=driver.id,
            provider="manual_app",
            amount=amount,
            status="pending",
            photo_file_id=stored_path,
            receipt_sha256=receipt_sha256,
        )
        session.add(payment)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            file_path.unlink(missing_ok=True)
            return web.json_response(
                {"error": "Bu to'lov cheki avval yuborilgan"}, status=409
            )
        session.refresh(payment)
        payment_id = payment.id
        drv_name = driver.first_name or ""
        drv_phone = driver.phone or ""
        drv_tg = driver.telegram_id
    finally:
        session.close()

    # Send the screenshot to the admin via the bot with Approve/Reject buttons.
    bot = request.app.get("bot")
    if bot is None:
        logger.error("topup: bot is not available on app context")
        cleaned = _delete_pending_payment_artifacts(payment_id, file_path)
        if not cleaned:
            return web.json_response({
                "success": True,
                "payment_id": payment_id,
                "status": "processing",
                "message": "To'lov allaqachon qayta ishlanmoqda.",
            }, status=202)
        return web.json_response({
            "error": "Hozircha to'lovni yuborib bo'lmadi. Keyinroq urinib ko'ring.",
        }, status=503)

    try:
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"{APP_TOPUP_OK_PREFIX}{payment_id}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"{APP_TOPUP_NO_PREFIX}{payment_id}")],
        ])
        amount_str = f"{amount:,}".replace(",", " ")
        caption = (
            "🧾 <b>YANGI TO'LOV (ILOVA)</b>\n"
            f"👤 {drv_name}\n"
            f"🆔 <code>{drv_tg}</code>\n"
            f"📞 {drv_phone}\n"
            f"💰 {amount_str} so'm\n"
            f"🧷 Payment #{payment_id}"
        )
        with open(file_path, "rb") as photo:
            await bot.send_photo(
                config.ADMIN_ID,
                photo=photo,
                caption=caption,
                reply_markup=keyboard,
                parse_mode="HTML",
            )
    except Exception as e:
        logger.exception(f"topup send_photo to admin failed: {e}")
        cleaned = _delete_pending_payment_artifacts(payment_id, file_path)
        if not cleaned:
            return web.json_response({
                "success": True,
                "payment_id": payment_id,
                "status": "processing",
                "message": "To'lov allaqachon qayta ishlanmoqda.",
            }, status=202)
        return web.json_response({
            "error": "To'lovni adminga yuborishda xatolik. Keyinroq urinib ko'ring.",
        }, status=502)

    return web.json_response({
        "success": True,
        "payment_id": payment_id,
        "amount": amount,
        "status": "pending",
        "receipt_uploaded": True,
        "message": "To'lov skrinshoti yuborildi. Admin tasdiqlashini kuting.",
    })
