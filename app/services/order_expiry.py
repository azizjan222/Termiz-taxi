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

The same loop also runs a second sweep, ``cancel_abandoned_orders``, which closes orders a
driver ACCEPTED and then abandoned without ever starting the trip. Without it those orders
stayed ``"accepted"`` forever and permanently consumed an active-order slot for both the
passenger and the driver. See that function's docstring for its (deliberately narrow)
scope and its money policy.

The DB work is synchronous (easy to test, safe on SQLite and Postgres). The status
flip is done with an ATOMIC ``UPDATE ... WHERE status='new'`` per order — exactly like
``accept_order`` — so we can never expire an order a driver accepted in the same instant.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from app import config
from app.database import get_session
from app.models import Order, User
from app.services.promo import release_promo_for_order
from app.services.rewards import release_bonus_for_order

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
                # No driver ever took the ride, so give any promo redemption back --
                # otherwise a single-use code is burnt by an order that never happened.
                # (Bonus needs no release here: it is only reserved on accept.)
                session.refresh(order)
                try:
                    release_promo_for_order(session, order)
                except Exception as promo_error:  # pragma: no cover - defensive
                    logger.error(
                        "Promo release failed for expired order %s: %s",
                        order.id, promo_error,
                    )
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


def cancel_abandoned_orders(now: datetime | None = None) -> list[dict]:
    """Close orders a driver accepted but never started or completed.

    Nothing in the app flow ever ended such an order: ``expire_stale_orders`` only looks at
    status ``"new"``, and complete/cancel are both driver-initiated. So a driver who
    accepted a ride and then vanished left it ``"accepted"`` permanently, which:

      * consumed one of the passenger's ``MAX_ACTIVE_ORDERS_PER_USER`` slots, so they were
        told "Sizda faol buyurtma bor" and could not order again;
      * consumed one of the driver's ``MAX_ACTIVE_NONPARCEL_ORDERS`` slots forever;
      * left the passenger with no notification that the ride was never happening.

    Deliberate scope and money policy, since both are judgement calls:

    * Only status ``"accepted"`` is reaped. An ``"in_progress"`` ride is one the driver has
      physically begun — Termiz→Denov alone is 75-95 km — and cancelling a real journey
      under the passenger would be worse than leaving it open. Those need a human.
    * The commission is NOT refunded. The driver consumed the lead (and by this point the
      15-minute window has long since charged it); refunding would make hoarding orders
      free. We only set ``commission_charged`` so the scheduler stops reconsidering it.
    * The passenger's bonus IS returned and their promo code IS un-burnt, because the ride
      did not happen — the same rule the two cancel endpoints already follow.

    Returns ``{"order_id", "passenger_id", "driver_telegram_id", "from_city", "to_city"}``
    dicts for the orders actually closed, so the caller can notify both parties.
    Synchronous (DB only) so it is easy to test.
    """
    if config.ORDER_ABANDON_MINUTES <= 0:
        return []

    now = now or datetime.utcnow()
    cutoff = now - timedelta(minutes=config.ORDER_ABANDON_MINUTES)
    closed: list[dict] = []

    session = get_session()
    try:
        candidates = (
            session.query(Order)
            .filter(
                Order.status == "accepted",
                Order.accepted_at != None,  # noqa: E711
                Order.accepted_at <= cutoff,
            )
            .all()
        )

        for order in candidates:
            # Atomic claim, mirroring every other status transition: never close an order
            # the driver started or completed in the same instant.
            claimed = (
                session.query(Order)
                .filter(Order.id == order.id, Order.status == "accepted")
                .update(
                    {
                        "status": "cancelled",
                        "cancelled_at": now,
                        "cancelled_by": "system",
                        "cancel_reason": "Haydovchi safarni boshlamadi (vaqt tugadi)",
                        # Stop the commission scheduler from revisiting this order.
                        "commission_charged": True,
                    },
                    synchronize_session=False,
                )
            )
            if not claimed:
                continue

            session.refresh(order)
            passenger = None
            if order.passenger_id:
                passenger = (
                    session.query(User)
                    .filter_by(id=order.passenger_id)
                    .with_for_update()
                    .first()
                )
            try:
                release_bonus_for_order(session, order, passenger)
            except Exception as bonus_error:  # pragma: no cover - defensive
                logger.error(
                    "Bonus release failed for abandoned order %s: %s", order.id, bonus_error
                )
            try:
                release_promo_for_order(session, order)
            except Exception as promo_error:  # pragma: no cover - defensive
                logger.error(
                    "Promo release failed for abandoned order %s: %s", order.id, promo_error
                )

            # Commit per order so one bad row cannot discard the whole sweep.
            try:
                session.commit()
            except Exception as commit_error:  # pragma: no cover - defensive
                session.rollback()
                logger.error(
                    "Could not close abandoned order %s: %s", order.id, commit_error
                )
                continue

            logger.warning(
                "Closed abandoned order %s (driver %s accepted at %s, never started)",
                order.id, order.driver_id, order.accepted_at,
            )
            closed.append({
                "order_id": order.id,
                "passenger_id": order.passenger_id,
                "driver_telegram_id": order.driver_telegram_id,
                "from_city": order.from_city,
                "to_city": order.to_city,
            })
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"cancel_abandoned_orders failed: {e}")
    finally:
        session.close()

    return closed


async def cancel_abandoned_and_notify() -> int:
    """Close abandoned orders and tell both parties. Returns how many were closed."""
    closed = await asyncio.to_thread(cancel_abandoned_orders)
    if not closed:
        return 0

    from app.api.websocket import ws_manager

    for info in closed:
        order_id = info.get("order_id")
        passenger_id = info.get("passenger_id")
        driver_telegram_id = info.get("driver_telegram_id")
        if passenger_id:
            try:
                await ws_manager.send_to_passenger(passenger_id, {
                    "type": "order_cancelled",
                    "order_id": order_id,
                    "by": "system",
                })
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("WS notify failed for abandoned order %s: %s", order_id, e)
        if driver_telegram_id:
            try:
                await ws_manager.send_to_driver(driver_telegram_id, {
                    "type": "order_cancelled",
                    "order_id": order_id,
                    "by": "system",
                })
            except Exception as e:  # pragma: no cover - defensive
                logger.warning(
                    "WS notify to driver failed for abandoned order %s: %s", order_id, e
                )

    return len(closed)


async def order_expiry_loop(stop_event: asyncio.Event | None = None):
    """Run both sweeps periodically until stop_event is set (or forever).

    Sweep 1 expires ``"new"`` orders nobody accepted; sweep 2 closes ``"accepted"`` orders
    the driver never started. They share this one loop because both are cheap indexed
    queries on the same table and both need the same cadence.
    """
    logger.info(
        "Order-expiry scheduler started (expiry=%s min, abandon=%s min, poll=%ss)",
        config.ORDER_EXPIRY_MINUTES, config.ORDER_ABANDON_MINUTES, _POLL_SECONDS,
    )
    while True:
        # The two sweeps are independent: a failure in one must not skip the other,
        # so they get their own try/except rather than sharing one.
        try:
            n = await expire_orders_and_notify()
            if n:
                logger.info("Expired %s stale order(s)", n)
        except Exception as e:  # pragma: no cover - defensive
            logger.error(f"Order-expiry loop error: {e}")

        try:
            n = await cancel_abandoned_and_notify()
            if n:
                logger.info("Closed %s abandoned order(s)", n)
        except Exception as e:  # pragma: no cover - defensive
            logger.error(f"Abandoned-order sweep error: {e}")

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
