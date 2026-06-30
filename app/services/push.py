"""Push notification service via Expo Push API."""
import json
import logging
from typing import Optional

import aiohttp
from sqlalchemy.orm import Session

from app.models import Driver, User, NotificationLog

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _fmt_amount(value: int) -> str:
    """Format a so'm amount with spaces as thousands separators."""
    return f"{value:,}".replace(",", " ")


def _order_subject(order) -> str:
    """Service-aware short description of what was ordered.

    Parcel orders must NOT say "X kishi" (X persons) — that wording only makes
    sense for taxi rides. Full-car orders get their own label too.
    """
    service_type = getattr(order, "service_type", "taxi")
    if service_type == "parcel":
        return "Pochta 📦"
    if service_type == "full_car":
        return "To'liq mashina"
    return f"{order.person_count} kishi"


def _new_order_title(order) -> str:
    """Service-aware push title."""
    if getattr(order, "service_type", "taxi") == "parcel":
        return "📦 Yangi pochta!"
    return "🚕 Yangi zakas!"


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
    if not token.startswith("ExponentPushToken[") and not token.startswith("ExpoPushToken["):
        # Allow tokens that don't have the wrapper if user manually entered
        pass

    payload = {
        "to": token,
        "title": title,
        "body": body,
        "sound": sound,
        "priority": priority,
        "data": data or {},
    }
    if channel_id:
        payload["channelId"] = channel_id

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


async def notify_driver_new_order(session: Session, order, drivers: list):
    """Notify all online drivers about a new order — sent as ONE batched Expo request
    instead of N sequential HTTP calls, so every driver is alerted at the same instant
    (sequential sending made the last drivers in a big list get the push noticeably late).
    Dead tokens (DeviceNotRegistered) are cleared as a side effect.
    """
    targets = [d for d in drivers if d.push_token and d.is_online]
    if not targets:
        return

    title = _new_order_title(order)
    body = f"{order.from_city} → {order.to_city} · {_order_subject(order)} · {_fmt_amount(order.price)} so'm"
    data = {"type": "new_order", "order_id": order.id}
    data_json = json.dumps(data)

    # Expo caps a batch at 100 messages.
    for start in range(0, len(targets), 100):
        chunk = targets[start:start + 100]
        messages = [
            {
                "to": d.push_token,
                "title": title,
                "body": body,
                "sound": "new_order.wav",
                "priority": "high",
                "channelId": "orders_v2",
                "data": data,
            }
            for d in chunk
        ]
        tickets = await _expo_send_batch(messages)
        for i, d in enumerate(chunk):
            ticket = tickets[i] if i < len(tickets) else None
            ok = isinstance(ticket, dict) and ticket.get("status") == "ok"
            log_entry = NotificationLog(
                recipient_type="driver",
                recipient_id=d.id,
                title=title,
                body=body,
                data=data_json,
            )
            log_entry.status = "sent" if ok else "failed"
            if not ok:
                log_entry.error = (
                    ticket.get("message", "Unknown") if isinstance(ticket, dict) else "No ticket"
                )
                if isinstance(ticket, dict) and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    d.push_token = None  # drop the dead token
            session.add(log_entry)
        session.commit()


async def notify_passenger_order_accepted(session: Session, order, driver):
    """Notify passenger that driver was found."""
    if not order.passenger_id:
        return
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title="✅ Haydovchi topildi!",
        body=f"{driver.first_name or 'Haydovchi'} ({driver.car_model or 'Mashina'}) tez orada siz bilan bog'lanadi",
        data={
            "type": "order_accepted",
            "order_id": order.id,
        },
        channel_id="orders_v2",
    )


async def notify_driver_recommended_order(session: Session, order, driver):
    """Direct notification to a driver the passenger picked from recommendations (group D)."""
    if not driver or not driver.push_token:
        return
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=driver.id,
        title="⭐ Sizga maxsus zakas!",
        body=f"{order.from_city} → {order.to_city} · {_order_subject(order)} · {order.departure_time or 'Hozir'}",
        data={
            "type": "new_order",
            "order_id": order.id,
            "direct": True,
        },
        sound="new_order.wav",
        channel_id="orders_v2",
    )


async def notify_order_cancelled(
    session: Session, order, by: str, recipient_type: str, recipient_id: int
):
    """Notify when order is cancelled."""
    title_map = {
        "passenger": "❌ Yo'lovchi bekor qildi",
        "driver": "❌ Haydovchi bekor qildi",
        "system": "⏰ Vaqt tugadi",
        "admin": "⚠️ Admin bekor qildi",
    }
    title = title_map.get(by, "❌ Buyurtma bekor qilindi")
    await send_push(
        session,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        title=title,
        body=f"{order.from_city} → {order.to_city}",
        data={
            "type": "order_cancelled",
            "order_id": order.id,
            "by": by,
        },
        channel_id="orders_v2",
    )


async def notify_order_completed(session: Session, order):
    """Notify passenger that ride is complete."""
    if not order.passenger_id:
        return
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title="🏁 Manzilga yetib keldingiz!",
        body="Sayohatingizni baholang ⭐",
        data={
            "type": "order_completed",
            "order_id": order.id,
        },
        channel_id="orders_v2",
    )


async def notify_passenger_no_driver(session: Session, order):
    """Notify passenger that no driver accepted in time (order auto-expired)."""
    if not order.passenger_id:
        return
    await send_push(
        session,
        recipient_type="user",
        recipient_id=order.passenger_id,
        title="⏰ Haydovchi topilmadi",
        body=(
            f"{order.from_city} → {order.to_city} · "
            "Afsuski, hozircha haydovchi topilmadi. Qaytadan urinib ko'ring."
        ),
        data={
            "type": "order_expired",
            "order_id": order.id,
        },
        channel_id="orders_v2",
    )


async def notify_balance_topup(session: Session, driver_id: int, amount: int, bonus: int = 0):
    """Notify driver about balance top-up."""
    body = f"+{_fmt_amount(amount)} so'm"
    if bonus > 0:
        body += f"\n🎁 Bonus: +{_fmt_amount(bonus)} so'm"
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=driver_id,
        title="💰 Balans to'ldirildi!",
        body=body,
        data={"type": "balance_topup", "amount": amount, "bonus": bonus},
        channel_id="balance",
    )
