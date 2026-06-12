"""Push notification service via Expo Push API."""
import json
import logging
from typing import Optional

import aiohttp
from sqlalchemy.orm import Session

from app.models import Driver, User, NotificationLog

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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


async def notify_driver_new_order(session: Session, order, drivers: list):
    """Notify all online drivers about new order."""
    for driver in drivers:
        if not driver.push_token or not driver.is_online:
            continue
        await send_push(
            session,
            recipient_type="driver",
            recipient_id=driver.id,
            title="🚕 Yangi zakas!",
            body=f"{order.from_city} → {order.to_city} · {order.person_count} kishi · {order.price:,} so'm".replace(",", " "),
            data={
                "type": "new_order",
                "order_id": order.id,
            },
            channel_id="orders",
        )


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
        channel_id="orders",
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
        body=f"{order.from_city} → {order.to_city} · {order.person_count} kishi · {order.departure_time or 'Hozir'}",
        data={
            "type": "new_order",
            "order_id": order.id,
            "direct": True,
        },
        channel_id="orders",
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
        channel_id="orders",
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
        channel_id="orders",
    )


async def notify_balance_topup(session: Session, driver_id: int, amount: int, bonus: int = 0):
    """Notify driver about balance top-up."""
    body = f"+{amount:,} so'm".replace(",", " ")
    if bonus > 0:
        body += f"\n🎁 Bonus: +{bonus:,} so'm".replace(",", " ")
    await send_push(
        session,
        recipient_type="driver",
        recipient_id=driver_id,
        title="💰 Balans to'ldirildi!",
        body=body,
        data={"type": "balance_topup", "amount": amount, "bonus": bonus},
        channel_id="balance",
    )
