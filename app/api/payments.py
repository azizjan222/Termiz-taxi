"""Payment endpoints - Click Uz, Payme, and manual card top-up."""
import base64
import hashlib
import hmac
import json
import os
import time
import uuid
import logging
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from aiohttp import web

from app import config
from app.api.drivers import require_driver
from app.database import get_session
from app.models import Driver, Payment, Setting

logger = logging.getLogger(__name__)

# Where uploaded payment screenshots are stored (same persistent volume as other uploads).
TOPUP_UPLOAD_DIR = Path(config.UPLOAD_DIR)
TOPUP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
TOPUP_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
TOPUP_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


def credit_driver_payment(session, payment: Payment):
    """Credit a pending payment to the driver's DB balance.

    Applies the 50% first-payment bonus using the same `first_payers` Setting logic
    as the Click/Payme flows (so a driver never gets the bonus twice). Mutates the
    payment (status/bonus_amount/processed_at) and the driver's balance, but does NOT
    commit - the caller is responsible for committing.

    Returns a tuple: (amount, bonus, driver).
    """
    driver = session.query(Driver).filter_by(id=payment.driver_id).first()
    bonus = 0
    if driver:
        first_payers = session.query(Setting).filter_by(key="first_payers").first()
        first_payers_list = []
        if first_payers and first_payers.value:
            try:
                first_payers_list = json.loads(first_payers.value)
            except Exception:
                first_payers_list = []

        if driver.telegram_id and driver.telegram_id not in first_payers_list:
            bonus = int(payment.amount * 0.5)
            first_payers_list.append(driver.telegram_id)
            if first_payers:
                first_payers.value = json.dumps(first_payers_list)
            else:
                session.add(Setting(key="first_payers", value=json.dumps(first_payers_list)))

        driver.balance = (driver.balance or 0) + payment.amount + bonus
        payment.bonus_amount = bonus

    payment.status = "approved"
    payment.processed_at = datetime.utcnow()
    return payment.amount, bonus, driver


def _verify_click_signature(data: dict, action: str) -> bool:
    """Verify Click Uz signature.
    Click sends sign_string which is MD5 of:
    click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time
    For complete: + merchant_prepare_id between merchant_trans_id and amount.
    """
    if not config.CLICK_SECRET_KEY:
        # If no secret configured, accept all (dev mode)
        return True

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

    # Manual card (always available)
    methods.append({
        "id": "card",
        "name": "Karta orqali",
        "icon": "💳",
        "description": "Kartaga to'lab, chekni botga yuborasiz",
        "card_number": config.TOPUP_CARD_NUMBER,
        "card_holder": config.TOPUP_CARD_HOLDER,
        "instant": False,
    })

    # Click Uz
    if config.CLICK_MERCHANT_ID and config.CLICK_SERVICE_ID:
        methods.append({
            "id": "click",
            "name": "Click Uz",
            "icon": "💙",
            "description": "Click Uz orqali to'lash",
            "instant": True,
        })
    else:
        methods.append({
            "id": "click",
            "name": "Click Uz",
            "icon": "💙",
            "description": "Tez orada qo'shiladi",
            "instant": True,
            "disabled": True,
        })

    # Payme
    if config.PAYME_MERCHANT_ID:
        methods.append({
            "id": "payme",
            "name": "Payme",
            "icon": "💚",
            "description": "Payme orqali to'lash",
            "instant": True,
        })
    else:
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
    if amount < 1000:
        return web.json_response({"error": "Minimal summa 1000 so'm"}, status=400)

    if not config.CLICK_MERCHANT_ID:
        return web.json_response({
            "error": "Click Uz hozircha mavjud emas. Karta orqali to'ldiring",
        }, status=503)

    # Create pending payment record
    session = get_session()
    try:
        payment = Payment(
            driver_id=driver.id,
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
        payment = session.query(Payment).filter_by(id=int(transaction_param)).first()
        if not payment:
            return web.json_response({"error": -5, "error_note": "Transaction not found"})

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
    error_code = int(data.get("error", -1))

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(id=int(transaction_param)).first()
        if not payment:
            return web.json_response({"error": -5, "error_note": "Transaction not found"})

        if payment.status == "approved":
            return web.json_response({
                "click_trans_id": data.get("click_trans_id"),
                "merchant_trans_id": transaction_param,
                "merchant_confirm_id": payment.id,
                "error": 0,
                "error_note": "Already processed",
            })

        if error_code == 0:
            # Success - credit driver balance
            driver = session.query(Driver).filter_by(id=payment.driver_id).first()
            if driver:
                # Apply 50% bonus on first top-up
                from app.models import Setting
                first_payers = session.query(Setting).filter_by(key="first_payers").first()
                first_payers_list = []
                if first_payers and first_payers.value:
                    import json
                    try:
                        first_payers_list = json.loads(first_payers.value)
                    except Exception:
                        first_payers_list = []

                bonus = 0
                if driver.telegram_id and driver.telegram_id not in first_payers_list:
                    bonus = int(payment.amount * 0.5)
                    first_payers_list.append(driver.telegram_id)
                    if first_payers:
                        first_payers.value = json.dumps(first_payers_list)
                    else:
                        session.add(Setting(key="first_payers", value=json.dumps(first_payers_list)))

                driver.balance = (driver.balance or 0) + payment.amount + bonus
                payment.bonus_amount = bonus

            payment.status = "approved"
            from datetime import datetime
            payment.processed_at = datetime.utcnow()
            session.commit()

            return web.json_response({
                "click_trans_id": data.get("click_trans_id"),
                "merchant_trans_id": transaction_param,
                "merchant_confirm_id": payment.id,
                "error": 0,
                "error_note": "Success",
            })
        else:
            payment.status = "rejected"
            session.commit()
            return web.json_response({
                "error": error_code,
                "error_note": "Cancelled",
            })
    finally:
        session.close()


# ============= PAYME =============

@require_driver
async def create_payme_payment(request: web.Request) -> web.Response:
    """POST /api/payments/payme/create
    Returns Payme checkout URL.
    """
    driver: Driver = request["driver"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    amount = int(data.get("amount", 0))
    if amount < 1000:
        return web.json_response({"error": "Minimal summa 1000 so'm"}, status=400)

    if not config.PAYME_MERCHANT_ID:
        return web.json_response({
            "error": "Payme hozircha mavjud emas. Karta orqali to'ldiring",
        }, status=503)

    # Create payment record
    session = get_session()
    try:
        payment = Payment(driver_id=driver.id, amount=amount, status="pending")
        session.add(payment)
        session.commit()
        session.refresh(payment)
        payment_id = payment.id
    finally:
        session.close()

    # Payme uses base64-encoded params in URL
    # Format: m=MERCHANT_ID;ac.account_id=PAYMENT_ID;a=AMOUNT_IN_TIYIN
    amount_tiyin = amount * 100
    params_str = f"m={config.PAYME_MERCHANT_ID};ac.account_id={payment_id};a={amount_tiyin}"
    encoded = base64.b64encode(params_str.encode()).decode()
    base_url = "https://test.paycom.uz" if config.PAYME_TEST_MODE else "https://checkout.paycom.uz"
    url = f"{base_url}/{encoded}"

    return web.json_response({
        "payment_id": payment_id,
        "url": url,
        "amount": amount,
    })


async def payme_webhook(request: web.Request) -> web.Response:
    """POST /api/payments/payme/webhook
    Payme JSON-RPC webhook (CheckPerformTransaction, CreateTransaction, etc.)
    https://help.paycom.uz/
    """
    # Auth via Basic header (Paycom:SECRET_KEY)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Basic "):
        return web.json_response({
            "error": {"code": -32504, "message": "Unauthorized"},
        })

    try:
        decoded = base64.b64decode(auth[6:]).decode()
        _, secret = decoded.split(":", 1)
        if config.PAYME_SECRET_KEY and secret != config.PAYME_SECRET_KEY:
            return web.json_response({
                "error": {"code": -32504, "message": "Invalid credentials"},
            })
    except Exception:
        return web.json_response({"error": {"code": -32504}})

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": {"code": -32700, "message": "Parse error"}})

    method = body.get("method", "")
    params = body.get("params", {})
    request_id = body.get("id", 1)

    # Implement minimum methods for Payme
    # Full spec: https://developer.help.paycom.uz/protokol-merchant-api/
    if method == "CheckPerformTransaction":
        account = params.get("account", {})
        payment_id = account.get("account_id")
        amount = params.get("amount", 0) // 100  # tiyin to som

        session = get_session()
        try:
            payment = session.query(Payment).filter_by(id=int(payment_id)).first()
            if not payment:
                return web.json_response({
                    "id": request_id,
                    "error": {"code": -31050, "message": "Payment not found"},
                })
            if payment.amount != amount:
                return web.json_response({
                    "id": request_id,
                    "error": {"code": -31001, "message": "Wrong amount"},
                })
            return web.json_response({
                "id": request_id,
                "result": {"allow": True},
            })
        finally:
            session.close()

    elif method == "CreateTransaction":
        # Implementation simplified - production needs full state machine
        return web.json_response({
            "id": request_id,
            "result": {
                "create_time": int(time.time() * 1000),
                "transaction": str(params.get("id", "")),
                "state": 1,
            },
        })

    elif method == "PerformTransaction":
        # Apply payment to balance
        account = params.get("account", {})
        payment_id = account.get("account_id")

        session = get_session()
        try:
            payment = session.query(Payment).filter_by(id=int(payment_id)).first()
            if payment and payment.status == "pending":
                driver = session.query(Driver).filter_by(id=payment.driver_id).first()
                if driver:
                    driver.balance = (driver.balance or 0) + payment.amount
                payment.status = "approved"
                from datetime import datetime
                payment.processed_at = datetime.utcnow()
                session.commit()
            return web.json_response({
                "id": request_id,
                "result": {
                    "perform_time": int(time.time() * 1000),
                    "transaction": str(params.get("id", "")),
                    "state": 2,
                },
            })
        finally:
            session.close()

    return web.json_response({
        "id": request_id,
        "error": {"code": -32601, "message": "Method not found"},
    })


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

    if amount < 1000:
        return web.json_response({"error": "Minimal summa 1000 so'm"}, status=400)
    if not file_bytes:
        return web.json_response({"error": "To'lov skrinshotini yuklang"}, status=400)

    # Save the screenshot to disk.
    new_filename = f"topup_{driver.id}_{uuid.uuid4().hex[:8]}{file_ext}"
    file_path = TOPUP_UPLOAD_DIR / new_filename
    try:
        with open(file_path, "wb") as f:
            f.write(file_bytes)
    except Exception as e:
        logger.exception(f"topup save error: {e}")
        return web.json_response({"error": "Faylni saqlashda xatolik"}, status=500)

    public_url = f"/uploads/{new_filename}"

    # Create a pending payment row.
    session = get_session()
    try:
        payment = Payment(
            driver_id=driver.id,
            amount=amount,
            status="pending",
            photo_file_id=public_url,  # local path until the bot returns a telegram file_id
        )
        session.add(payment)
        session.commit()
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
            sent = await bot.send_photo(
                config.ADMIN_ID,
                photo=photo,
                caption=caption,
                reply_markup=keyboard,
                parse_mode="HTML",
            )
        # Persist the telegram file_id for parity with the bot flow.
        try:
            if sent and sent.photo:
                tg_file_id = sent.photo[-1].file_id
                session = get_session()
                try:
                    p = session.query(Payment).filter_by(id=payment_id).first()
                    if p:
                        p.photo_file_id = tg_file_id
                        session.commit()
                finally:
                    session.close()
        except Exception:
            pass
    except Exception as e:
        logger.exception(f"topup send_photo to admin failed: {e}")
        return web.json_response({
            "error": "To'lovni adminga yuborishda xatolik. Keyinroq urinib ko'ring.",
        }, status=502)

    return web.json_response({
        "success": True,
        "payment_id": payment_id,
        "amount": amount,
        "status": "pending",
        "screenshot_url": public_url,
        "message": "To'lov skrinshoti yuborildi. Admin tasdiqlashini kuting.",
    })
