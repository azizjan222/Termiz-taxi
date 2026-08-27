"""Push notification service via Expo Push API.

All user-facing push text is localized to the recipient's language
(``User.language`` / ``Driver.language``) via :mod:`app.services.notify_i18n`,
with an Uzbek fallback.
"""
import json
import logging
from typing import Optional

import aiohttp
from sqlalchemy.orm import Session

from app.models import Driver, NotificationLog, User
from app.services import notify_i18n as nt

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Delivery outcomes live behind a second call: the send response is only an acceptance
# ticket. See check_push_receipts().
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"

# Localized fallback words used when a name/field is missing.
_DRIVER_W = {"uz": "Haydovchi", "uz-cyrl": "Ҳайдовчи", "ru": "Водитель", "en": "Driver"}
_CAR_W = {"uz": "Mashina", "uz-cyrl": "Машина", "ru": "Машина", "en": "Car"}
_NOW_W = {"uz": "Hozir", "uz-cyrl": "Ҳозир", "ru": "Сейчас", "en": "Now"}


def _fmt_amount(value: int) -> str:
    """Format a so'm amount with spaces as thousands separators."""
    return f"{value:,}".replace(",", " ")


def _lang_of(recipient) -> str:
    """Recipient's language (uz fallback)."""
    return nt.norm_lang(getattr(recipient, "language", None))


def _lang(session: Session, recipient_type: str, recipient_id: int) -> str:
    """Look up a recipient's language by type + id."""
    if recipient_type == "driver":
        r = session.query(Driver).filter_by(id=recipient_id).first()
    else:
        r = session.query(User).filter_by(id=recipient_id).first()
    return _lang_of(r) if r else "uz"


async def send_push(
    session: Session,
    *,
    recipient_type: str,  # 'user' or 'driver'
    recipient_id: int,
    title: str,
    body: str,
    data: Optional[dict] = None,
    sound: str = "default",
    priority: str = "high",
    channel_id: Optional[str] = None,
) -> bool:
    """Send a single push notification.

    Returns True if delivered to Expo (not necessarily to device).
    """
    if recipient_type == "user":
        recipient = session.query(User).filter_by(id=recipient_id).first()
    elif recipient_type == "driver":
        recipient = session.query(Driver).filter_by(id=recipient_id).first()
    else:
        return False

    if not recipient or not recipient.push_token:
        return False

    token = recipient.push_token

    # Refuse a token Expo cannot parse instead of spending a request to be told so. The
    # stored value is cleared, otherwise every future send repeats the same failure and
    # counts against the project's rate limit.
    if not looks_like_expo_token(token):
        logger.warning(
            "Malformed push token on %s %s — clearing it", recipient_type, recipient_id
        )
        recipient.push_token = None
        session.commit()
        return False

    payload = {
        "to": token,
        "title": title,
        "body": body,
        "sound": sound,
        "priority": priority,
        "data": data or {},
    }
    # Always pin a HIGH/MAX-importance Android channel. Without a channelId (or with one
    # the app never registered) Android demotes the push to a low-importance fallback,
    # which Doze then delays on a closed app -> the notification arrives late. Defaulting
    # to the registered "orders_v2" (MAX) channel keeps closed-app delivery real-time.
    payload["channelId"] = channel_id or "orders_v2"

    log_entry = NotificationLog(
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        title=title,
        body=body,
        data=json.dumps(data or {}),
    )

    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(
                EXPO_PUSH_URL,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                result = await resp.json()
                receipts = result.get("data", {})

                # A wholesale rejection puts the reason in a top-level `errors` array and
                # leaves `data` absent. That case used to fall straight through to
                # status="sent": rejected pushes were counted as successful, so the
                # dashboard showed healthy numbers for notifications nobody received.
                if result.get("errors") or not isinstance(receipts, dict) or not receipts:
                    reason = (
                        _describe_expo_errors(result["errors"])
                        if result.get("errors")
                        else "Expo javobida ticket yo'q"
                    )
                    logger.error("Expo rejected push to %s %s: %s",
                                 recipient_type, recipient_id, reason)
                    log_entry.status = "failed"
                    log_entry.error = reason
                    session.add(log_entry)
                    session.commit()
                    return False

                if receipts.get("status") == "error":
                    log_entry.status = "failed"
                    log_entry.error = receipts.get("message", "Unknown")
                    # Stale/uninstalled device -> drop the dead token so we stop wasting
                    # sends on it (repeated invalid tokens also get the app throttled by Expo).
                    if (receipts.get("details") or {}).get("error") == "DeviceNotRegistered":
                        recipient.push_token = None
                    session.add(log_entry)
                    session.commit()
                    return False

                log_entry.status = "sent"
                # Keep the receipt id: "sent" only means Expo accepted the message, and
                # FCM can still reject it later. check_push_receipts() resolves these.
                if isinstance(receipts, dict) and receipts.get("id"):
                    log_entry.ticket_id = str(receipts["id"])
                session.add(log_entry)
                session.commit()
                return True
    except Exception as e:
        logger.error(f"Push send error: {e}")
        log_entry.status = "failed"
        log_entry.error = str(e)
        try:
            session.add(log_entry)
            session.commit()
        except Exception:
            session.rollback()
        return False


def looks_like_expo_token(token) -> bool:
    """Whether a stored value can plausibly be sent to Expo.

    Worth checking before sending because Expo validates every token in a batch and
    rejects the WHOLE request if one of them is malformed. A single junk value — a test
    row, a hand-edited record — therefore used to silence every real driver in the same
    batch, and each of them was logged with the opaque error "No ticket".
    """
    if not isinstance(token, str):
        return False
    t = token.strip()
    return t.startswith("ExponentPushToken[") or t.startswith("ExpoPushToken[")


def _describe_expo_errors(errors) -> str:
    """Flatten Expo's top-level `errors` array into one readable line."""
    if not isinstance(errors, list):
        return str(errors)
    parts = []
    for err in errors:
        if isinstance(err, dict):
            code = err.get("code") or ""
            msg = err.get("message") or ""
            parts.append(f"{code}: {msg}".strip(": ").strip())
        else:
            parts.append(str(err))
    return " | ".join(p for p in parts if p) or "Expo rejected the request"


async def _expo_send_batch(messages: list) -> tuple:
    """POST a batch of Expo push messages in ONE request.

    Returns ``(tickets, error)``. ``tickets`` is aligned to `messages`; ``error`` is a
    readable reason when Expo rejected the request as a whole.

    The error used to be thrown away: the response's top-level `errors` array was never
    read, so a wholesale rejection surfaced only as an empty ticket list and every
    recipient was logged as "No ticket" with no way to find out why.
    """
    if not messages:
        return [], None
    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()
                if result.get("errors"):
                    reason = _describe_expo_errors(result["errors"])
                    logger.error(
                        "Expo rejected a batch of %d message(s): %s", len(messages), reason
                    )
                    return [], reason
                data = result.get("data", [])
                if isinstance(data, dict):  # single-message response shape
                    data = [data]
                if not isinstance(data, list):
                    return [], f"Unexpected Expo response shape: {type(data).__name__}"
                return data, None
    except Exception as e:
        logger.error(f"Expo batch send error: {e}")
        return [], str(e)


async def send_push_bulk(
    session: Session,
    items: list,
    *,
    sound: str = "default",
    channel_id: str = "orders_v2",
) -> int:
    """Send many (possibly DIFFERENT) messages in batched Expo requests.

    `items` is a list of dicts: {recipient_type, recipient_id, token, title, body, data}.
    Each item may carry its own already-localized title/body. Logs every send and clears
    DeviceNotRegistered tokens. Returns how many Expo accepted. Used for the admin
    broadcast and the new-order fan-out so the last recipient isn't alerted late.
    """
    def _clear_token(item):
        model = Driver if item["recipient_type"] == "driver" else User
        dead = session.query(model).filter_by(id=item["recipient_id"]).first()
        if dead:
            dead.push_token = None

    def _log(item, *, status, error=None, ticket_id=None):
        entry = NotificationLog(
            recipient_type=item["recipient_type"],
            recipient_id=item["recipient_id"],
            title=item["title"],
            body=item["body"],
            data=json.dumps(item.get("data") or {}),
        )
        entry.status = status
        entry.error = error
        entry.ticket_id = ticket_id
        session.add(entry)

    def _message(item):
        return {
            "to": item["token"],
            "title": item["title"],
            "body": item["body"],
            "sound": sound,
            "priority": "high",
            "channelId": item.get("channel_id", channel_id),
            "data": item.get("data") or {},
        }

    def _record(item, ticket, fallback_error):
        """Log one recipient's outcome. Returns True when Expo accepted the message."""
        if isinstance(ticket, dict) and ticket.get("status") == "ok":
            # See check_push_receipts(): acceptance is not delivery.
            _log(item, status="sent", ticket_id=str(ticket["id"]) if ticket.get("id") else None)
            return True
        if isinstance(ticket, dict):
            detail = (ticket.get("details") or {}).get("error")
            _log(item, status="failed", error=ticket.get("message") or detail or "Unknown")
            if detail == "DeviceNotRegistered":
                _clear_token(item)
        else:
            _log(item, status="failed", error=fallback_error or "No ticket")
        return False

    sent = 0

    # Drop unusable tokens BEFORE sending: one malformed value makes Expo reject the whole
    # batch, which is how a handful of junk rows silenced every real driver alongside them.
    usable = []
    for it in items:
        if looks_like_expo_token(it.get("token")):
            usable.append(it)
        else:
            _log(it, status="failed", error="Token Expo push token formatida emas")
            _clear_token(it)
    if len(usable) != len(items):
        logger.warning(
            "Dropped %d push recipient(s) with a malformed token", len(items) - len(usable)
        )
        session.commit()

    for start in range(0, len(usable), 100):
        chunk = usable[start:start + 100]
        tickets, batch_error = await _expo_send_batch([_message(it) for it in chunk])

        # Expo refused the request as a whole. Retry each message on its own so one bad
        # recipient cannot keep the rest of the batch from being delivered, and so the
        # per-recipient reason is recorded instead of a blanket failure.
        if not tickets and batch_error and len(chunk) > 1:
            logger.warning("Batch rejected (%s); retrying %d individually", batch_error, len(chunk))
            for it in chunk:
                one, one_error = await _expo_send_batch([_message(it)])
                if _record(it, one[0] if one else None, one_error or batch_error):
                    sent += 1
            session.commit()
            continue

        for i, it in enumerate(chunk):
            if _record(it, tickets[i] if i < len(tickets) else None, batch_error):
                sent += 1
        session.commit()

    return sent


async def check_push_receipts(session: Session, limit: int = 300) -> dict:
    """Resolve whether pushes marked "sent" were actually DELIVERED.

    Expo's send call returns a ticket, which only confirms Expo accepted the message. The
    real outcome lives in a receipt fetched separately by ticket id, and that is where the
    failures that matter show up:

      * MismatchSenderId   - the app's google-services.json belongs to a different Firebase
                             project than the FCM key uploaded to Expo. Sends look perfect
                             and nothing is ever delivered.
      * DeviceNotRegistered- the token is stale (app uninstalled/reinstalled).

    Nothing read receipts before, so every one of those failures was invisible: the log
    said "sent", the operator saw a healthy zero-error dashboard, and the notification
    still never arrived. Rows are updated in place to `delivered` or `failed`.
    """
    pending = (
        session.query(NotificationLog)
        .filter(NotificationLog.status == "sent")
        .filter(NotificationLog.ticket_id.isnot(None))
        .order_by(NotificationLog.id.desc())
        .limit(limit)
        .all()
    )
    if not pending:
        return {"checked": 0, "delivered": 0, "failed": 0, "pending": 0}

    by_ticket = {log.ticket_id: log for log in pending}
    delivered = failed = still_pending = 0

    ids = list(by_ticket.keys())
    for start in range(0, len(ids), 300):  # Expo accepts up to 300 ids per call
        chunk = ids[start:start + 300]
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(
                    EXPO_RECEIPTS_URL,
                    json={"ids": chunk},
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    result = await resp.json()
        except Exception as e:
            logger.error(f"Expo receipt fetch error: {e}")
            continue

        receipts = result.get("data") or {}
        if not isinstance(receipts, dict):
            continue

        for ticket_id, receipt in receipts.items():
            log = by_ticket.get(ticket_id)
            if not log or not isinstance(receipt, dict):
                continue
            status = receipt.get("status")
            if status == "ok":
                log.status = "delivered"
                delivered += 1
            elif status == "error":
                log.status = "failed"
                detail = (receipt.get("details") or {}).get("error")
                log.error = detail or receipt.get("message") or "Unknown receipt error"
                failed += 1
                # A stale token wastes every future send and gets the project throttled.
                if detail == "DeviceNotRegistered":
                    model = Driver if log.recipient_type == "driver" else User
                    dead = session.query(model).filter_by(id=log.recipient_id).first()
                    if dead:
                        dead.push_token = None
            else:
                still_pending += 1

    session.commit()
    return {
        "checked": len(ids),
        "delivered": delivered,
        "failed": failed,
        "pending": still_pending,
    }


async def notify_driver_new_order(session: Session, order, drivers: list):
    """Notify all online drivers about a new order — localized per driver and sent as ONE
    batched Expo request (instead of N sequential HTTP calls), so every driver is alerted
    at the same instant. Dead tokens are cleared as a side effect.
    """
    targets = [d for d in drivers if d.push_token and d.is_online]
    if not targets:
        return

    price_str = _fmt_amount(order.price or 0)
    data = {"type": "new_order", "order_id": order.id}
    items = []
    for d in targets:
        lang = _lang_of(d)
        title, body = nt.new_order(
            lang,
            service_type=order.service_type,
            from_city=order.from_city,
            to_city=order.to_city,
            subject_str=nt.subject(lang, order.service_type, order.person_count),
            price_str=price_str,
        )
        items.append({
            "recipient_type": "driver",
            "recipient_id": d.id,
            "token": d.push_token,
            "title": title,
            "body": body,
            "data": data,
        })
    await send_push_bulk(session, items, sound="new_order.wav", channel_id="orders_v2")


async def notify_passenger_order_accepted(session: Session, order, driver):
    """Notify passenger that driver was found (localized)."""
    if not order.passenger_id:
        return
    lang = _lang(session, "user", order.passenger_id)
    title, body = nt.order_accepted(
        lang,
        driver_name=driver.first_name or _DRIVER_W[lang],
        car=driver.car_model or _CAR_W[lang],
    )
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title=title,
        body=body,
        data={"type": "order_accepted", "order_id": order.id},
        channel_id="orders_v2",
    )


async def notify_driver_recommended_order(session: Session, order, driver):
    """Direct notification to a driver the passenger picked from recommendations (localized)."""
    if not driver or not driver.push_token:
        return
    lang = _lang_of(driver)
    title, body = nt.recommended_order(
        lang,
        from_city=order.from_city,
        to_city=order.to_city,
        subject_str=nt.subject(lang, order.service_type, order.person_count),
        time_str=order.departure_time or _NOW_W[lang],
    )
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=driver.id,
        title=title,
        body=body,
        data={"type": "new_order", "order_id": order.id, "direct": True},
        sound="new_order.wav",
        channel_id="orders_v2",
    )


async def notify_order_cancelled(
    session: Session, order, by: str, recipient_type: str, recipient_id: int
):
    """Notify when order is cancelled (localized to the recipient)."""
    lang = _lang(session, recipient_type, recipient_id)
    title, body = nt.order_cancelled(
        lang, by=by, from_city=order.from_city, to_city=order.to_city
    )
    await send_push(
        session,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        title=title,
        body=body,
        data={"type": "order_cancelled", "order_id": order.id, "by": by},
        # NOT "orders_v2": on Android the sound is a per-CHANNEL setting, and the
        # orders_v2 channel is pinned to the loud new_order.wav. Sending the cancel
        # there made a cancellation sound identical to a new order. Route it to a
        # dedicated HIGH-importance channel that plays its own distinct sound
        # (order_cancelled.wav) so the two events are clearly distinguishable.
        sound="order_cancelled.wav",
        channel_id="alerts_v1",
    )


async def notify_order_completed(session: Session, order):
    """Notify passenger that ride is complete (localized)."""
    if not order.passenger_id:
        return
    lang = _lang(session, "user", order.passenger_id)
    title, body = nt.order_completed(lang)
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title=title,
        body=body,
        data={"type": "order_completed", "order_id": order.id},
        channel_id="orders_v2",
    )


async def notify_passenger_no_driver(session: Session, order):
    """Notify passenger that no driver accepted in time (localized)."""
    if not order.passenger_id:
        return
    lang = _lang(session, "user", order.passenger_id)
    title, body = nt.no_driver(lang, from_city=order.from_city, to_city=order.to_city)
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title=title,
        body=body,
        data={"type": "order_expired", "order_id": order.id},
        channel_id="orders_v2",
    )


async def notify_driver_commission_soon(session: Session, order, minutes_left: int):
    """Heads-up to the driver that the deferred commission is about to be charged.

    Sent ~COMMISSION_WARN_MINUTES before the deduction so the driver can complete or
    cancel the order knowingly, instead of being surprised by the balance change.
    """
    if not getattr(order, "driver_id", None):
        return
    lang = _lang(session, "driver", order.driver_id)
    title, body = nt.commission_soon(
        lang,
        from_city=order.from_city,
        to_city=order.to_city,
        minutes=minutes_left,
        amount_str=_fmt_amount(order.commission or 0),
    )
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=order.driver_id,
        title=title,
        body=body,
        data={
            "type": "commission_warning",
            "order_id": order.id,
            "minutes_left": minutes_left,
        },
        channel_id="balance",
    )


async def notify_balance_topup(session: Session, driver_id: int, amount: int, bonus: int = 0):
    """Notify driver about balance top-up (localized)."""
    lang = _lang(session, "driver", driver_id)
    title, body = nt.balance_topup(
        lang,
        amount_str=_fmt_amount(amount),
        bonus_str=_fmt_amount(bonus) if bonus > 0 else None,
    )
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=driver_id,
        title=title,
        body=body,
        data={"type": "balance_topup", "amount": amount, "bonus": bonus},
        channel_id="balance",
    )
