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

from app.models import Driver, User, NotificationLog
from app.services import notify_i18n as nt

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

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
                if isinstance(receipts, dict) and receipts.get("status") == "error":
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


async def _expo_send_batch(messages: list) -> list:
    """POST a batch of Expo push messages in ONE request and return the tickets list
    (aligned to `messages`). Expo accepts up to 100 messages per call. Returns [] on
    transport failure so callers can mark everything failed without crashing.
    """
    if not messages:
        return []
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
                data = result.get("data", [])
                if isinstance(data, dict):  # single-message response shape
                    data = [data]
                return data if isinstance(data, list) else []
    except Exception as e:
        logger.error(f"Expo batch send error: {e}")
        return []


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
    sent = 0
    for start in range(0, len(items), 100):
        chunk = items[start:start + 100]
        messages = [
            {
                "to": it["token"],
                "title": it["title"],
                "body": it["body"],
                "sound": sound,
                "priority": "high",
                "channelId": it.get("channel_id", channel_id),
                "data": it.get("data") or {},
            }
            for it in chunk
        ]
        tickets = await _expo_send_batch(messages)
        for i, it in enumerate(chunk):
            ticket = tickets[i] if i < len(tickets) else None
            ok = isinstance(ticket, dict) and ticket.get("status") == "ok"
            log_entry = NotificationLog(
                recipient_type=it["recipient_type"],
                recipient_id=it["recipient_id"],
                title=it["title"],
                body=it["body"],
                data=json.dumps(it.get("data") or {}),
            )
            log_entry.status = "sent" if ok else "failed"
            if ok:
                sent += 1
            else:
                log_entry.error = (
                    ticket.get("message", "Unknown") if isinstance(ticket, dict) else "No ticket"
                )
                if isinstance(ticket, dict) and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    if it["recipient_type"] == "driver":
                        dead = session.query(Driver).filter_by(id=it["recipient_id"]).first()
                    else:
                        dead = session.query(User).filter_by(id=it["recipient_id"]).first()
                    if dead:
                        dead.push_token = None
            session.add(log_entry)
        session.commit()
    return sent


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
        channel_id="orders_v2",
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
