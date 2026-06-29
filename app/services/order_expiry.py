"""Auto-expiry for unaccepted passenger orders.

When a passenger places an order from the app it sits in status ``"new"`` until a driver
accepts it. If NOBODY accepts within ``ORDER_EXPIRY_MINUTES``, the order would otherwise
stay ``"new"`` forever and the passenger would wait on the "searching" screen
indefinitely. This background loop marks such stale, IMMEDIATE ("Hozir") orders as
``"expired"`` and notifies the passenger (push + WebSocket) so they can try again. The
passenger app already understands the ``"expired"`` status (it shows
"Vaqt tugadi — haydovchi topilmadi").

Only IMMEDIATE orders expire. Scheduled orders (``departure_time`` set to a future clock
time like "14:30") are intentionally left alone — they are meant to wait until then.

The DB work is synchronous (easy to test, safe on SQLite and Postgres). The status
flip is done with an ATOMIC ``UPDATE ... WHERE status='new'`` per order — exactly like
``accept_order`` — so we can never expire an order a driver accepted in the same instant.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from app.database import get_session
from app.models import Order
from app import config

logger = logging.getLogger("sarixgo.expiry")

# How often the loop wakes up to look for stale orders.
_POLL_SECONDS = 60

# departure_time values that mean "right now" -> eligible for time-based expiry.
# Anything else (e.g. "14:30", an ISO datetime) is treated as a SCHEDULED order and is
# NOT expired by creation time.
_IMMEDIATE_VALUES = {"", "hozir", "hozircha", "now", "сейчас", "сейчас."}


def _is_immediate(departure_time) -> bool:
    """True when the order is an immediate ("Hozir") ride, not a scheduled one."""
    return (departure_time or "Hozir").strip().lower() in _IMMEDIATE_VALUES


def expire_stale_orders(now: datetime | None = None) -> list[dict]:
    """Mark stale, immediate "new" orders as "expired".

    Returns a list of ``{"order_id", "passenger_id", "from_city", "to_city"}`` dicts for
    the orders that were actually expired (so the caller can notify the passengers).
    Synchronous (DB only) so it is easy to test.
    """
    now = now or datetime.utcnow()
    cutoff = now - timedelta(minutes=config.ORDER_EXPIRY_MINUTES)
    expired: list[dict] = []

    session = get_session()
    try:
        candidates = (
            session.query(Order)
            .filter(
                Order.status == "new",
                Order.created_at <= cutoff,
            )
            .all()
        )

        for order in candidates:
            # Leave scheduled (future-time) orders alone.
            if not _is_immediate(order.departure_time):
                continue

            # Atomic claim on status='new' so we never expire an order that a driver
            # just accepted in the same instant (mirrors accept_order's atomic update).
            claimed = (
                session.query(Order)
                .filter(Order.id == order.id, Order.status == "new")
                .update(
                    {
                        "status": "expired",
                        "cancelled_at": now,
                        "cancelled_by": "system",
                        "cancel_reason": "Haydovchi topilmadi (vaqt tugadi)",
                    },
                    synchronize_session=False,
                )
            )
            if claimed:
                expired.append({
                    "order_id": order.id,
                    "passenger_id": order.passenger_id,
                    "from_city": order.from_city,
                    "to_city": order.to_city,
                })

        session.commit()
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"expire_stale_orders failed: {e}")
    finally:
        session.close()

    return expired


async def expire_orders_and_notify() -> int:
    """Expire stale orders and notify each affected passenger (WebSocket + push).

    Returns the number of orders expired.
    """
    expired = await asyncio.to_thread(expire_stale_orders)
    if not expired:
        return 0

    # Imported lazily to avoid import cycles at module load time.
    from app.api.websocket import ws_manager
    from app.services.push import notify_passenger_no_driver

    session = get_session()
    try:
        for info in expired:
            passenger_id = info.get("passenger_id")
            order_id = info.get("order_id")

            # 1) WebSocket — instant feedback if the app is open. (The app's polling
            #    fallback also catches the "expired" status within a few seconds.)
            if passenger_id:
                try:
                    await ws_manager.send_to_passenger(passenger_id, {
                        "type": "order_expired",
                        "order_id": order_id,
                    })
                except Exception as e:
                    logger.warning(f"WS expire notify failed (order {order_id}): {e}")

            # 2) Push — reaches the passenger even when the app is backgrounded.
            try:
                order = session.query(Order).filter_by(id=order_id).first()
                if order and order.passenger_id:
                    await notify_passenger_no_driver(session, order)
            except Exception as e:
                logger.warning(f"Push expire notify failed (order {order_id}): {e}")
    finally:
        session.close()

    return len(expired)


async def order_expiry_loop(stop_event: asyncio.Event | None = None):
    """Periodically expire stale orders until stop_event is set (or forever)."""
    logger.info(
        "Order-expiry scheduler started (expiry=%s min, poll=%ss)",
        config.ORDER_EXPIRY_MINUTES, _POLL_SECONDS,
    )
    while True:
        try:
            n = await expire_orders_and_notify()
            if n:
                logger.info("Expired %s stale order(s)", n)
        except Exception as e:  # pragma: no cover - defensive
            logger.error(f"Order-expiry loop error: {e}")

        if stop_event is not None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=_POLL_SECONDS)
                if stop_event.is_set():
                    break
            except asyncio.TimeoutError:
                continue
        else:
            await asyncio.sleep(_POLL_SECONDS)


def start_order_expiry_scheduler() -> asyncio.Task:
    """Create and return the background task (call from the running event loop)."""
    return asyncio.create_task(order_expiry_loop())
