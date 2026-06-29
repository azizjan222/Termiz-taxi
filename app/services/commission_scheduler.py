"""Deferred-commission background task (group C).

After a driver accepts an order they get a 15-minute window to contact/agree with the
passenger. The commission is charged once that window elapses — whether or not the ride
was completed — UNLESS the driver is on the free trial / active subscription.

This runs as a simple asyncio periodic loop started alongside the API server. It is
intentionally lightweight (no apscheduler dependency wiring needed) and is safe to run
on both SQLite and Postgres.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from app.database import get_session
from app.models import Order, Driver
from app import config

logger = logging.getLogger("sarixgo.commission")

# How often the loop wakes up to look for orders whose window has elapsed.
_POLL_SECONDS = 60


def _subscription_active(driver: Driver, now: datetime) -> bool:
    return bool(driver and driver.subscription_until and driver.subscription_until > now)


def charge_due_commissions(now: datetime | None = None) -> int:
    """Charge commission for accepted orders whose 15-min window has elapsed.

    Returns the number of orders charged. Synchronous (DB only) so it is easy to test.
    """
    now = now or datetime.utcnow()
    cutoff = now - timedelta(minutes=config.COMMISSION_WINDOW_MINUTES)
    charged = 0

    session = get_session()
    try:
        # Orders that were accepted long enough ago and still owe a commission.
        orders = (
            session.query(Order)
            .filter(
                Order.commission_charged == False,  # noqa: E712
                Order.accepted_at != None,  # noqa: E711
                Order.accepted_at <= cutoff,
                Order.driver_id != None,  # noqa: E711
                Order.status.in_(["accepted", "in_progress", "completed"]),
            )
            .all()
        )

        for order in orders:
            driver = session.query(Driver).filter_by(id=order.driver_id).first()
            if not driver:
                # No driver to charge; mark so we don't keep re-scanning it.
                order.commission_charged = True
                continue

            # Free trial / active subscription -> no commission, just mark handled.
            if _subscription_active(driver, now):
                order.commission_charged = True
                continue

            commission = order.commission or 0
            if commission > 0:
                driver.balance = (driver.balance or 0) - commission
                # Money was actually deducted -> count it in revenue/stats.
                order.commission_collected = True
            order.commission_charged = True
            charged += 1

        session.commit()
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"charge_due_commissions failed: {e}")
    finally:
        session.close()

    return charged


async def warn_due_commissions(now: datetime | None = None) -> int:
    """Send a heads-up push/WS to drivers ~COMMISSION_WARN_MINUTES before their
    commission is charged, so the deduction isn't a surprise.

    Async (sends push) and uses a sync DB session the same way push.py does. Each order
    is warned at most once (commission_warned flag). Drivers on the free trial / active
    subscription are never charged, so they're never warned.
    """
    now = now or datetime.utcnow()
    # accepted long enough ago to be inside the warning window...
    warn_after = now - timedelta(
        minutes=max(0, config.COMMISSION_WINDOW_MINUTES - config.COMMISSION_WARN_MINUTES)
    )
    # ...but not yet past the full window (those get charged this cycle, not warned).
    charge_cutoff = now - timedelta(minutes=config.COMMISSION_WINDOW_MINUTES)
    warned = 0

    session = get_session()
    try:
        orders = (
            session.query(Order)
            .filter(
                Order.commission_warned == False,  # noqa: E712
                Order.commission_charged == False,  # noqa: E712
                Order.accepted_at != None,  # noqa: E711
                Order.accepted_at <= warn_after,
                Order.accepted_at > charge_cutoff,
                Order.driver_id != None,  # noqa: E711
                Order.status.in_(["accepted", "in_progress"]),
            )
            .all()
        )

        if orders:
            from app.services.push import notify_driver_commission_soon

        for order in orders:
            driver = session.query(Driver).filter_by(id=order.driver_id).first()
            # No driver, trial/subscription driver, or zero commission -> nothing to warn
            # about, but mark handled so we don't re-scan every minute.
            if not driver or _subscription_active(driver, now) or (order.commission or 0) <= 0:
                order.commission_warned = True
                continue

            elapsed_min = (now - order.accepted_at).total_seconds() / 60.0
            minutes_left = max(1, int(round(config.COMMISSION_WINDOW_MINUTES - elapsed_min)))

            try:
                await notify_driver_commission_soon(session, order, minutes_left)
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("commission warn push failed (order %s): %s", order.id, e)

            # WebSocket heads-up too, if the driver app is open.
            if getattr(order, "driver_telegram_id", None):
                try:
                    from app.api.websocket import ws_manager
                    await ws_manager.send_to_driver(order.driver_telegram_id, {
                        "type": "commission_warning",
                        "order_id": order.id,
                        "minutes_left": minutes_left,
                        "commission": order.commission or 0,
                    })
                except Exception as e:  # pragma: no cover - defensive
                    logger.warning("commission warn WS failed (order %s): %s", order.id, e)

            order.commission_warned = True
            warned += 1

        session.commit()
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"warn_due_commissions failed: {e}")
    finally:
        session.close()

    return warned


async def commission_scheduler_loop(stop_event: asyncio.Event | None = None):
    """Periodically charge due commissions until stop_event is set (or forever)."""
    logger.info(
        "Commission scheduler started (window=%s min, warn=%s min before, poll=%ss)",
        config.COMMISSION_WINDOW_MINUTES, config.COMMISSION_WARN_MINUTES, _POLL_SECONDS,
    )
    while True:
        try:
            # 1) Warn drivers whose commission is about to be charged.
            w = await warn_due_commissions()
            if w:
                logger.info("Warned %s driver(s) about upcoming commission", w)
            # 2) Charge the orders whose window has elapsed.
            n = await asyncio.to_thread(charge_due_commissions)
            if n:
                logger.info("Charged commission for %s order(s)", n)
        except Exception as e:  # pragma: no cover - defensive
            logger.error(f"Commission loop error: {e}")

        if stop_event is not None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=_POLL_SECONDS)
                if stop_event.is_set():
                    break
            except asyncio.TimeoutError:
                continue
        else:
            await asyncio.sleep(_POLL_SECONDS)


def start_commission_scheduler() -> asyncio.Task:
    """Create and return the background task (call from the running event loop)."""
    return asyncio.create_task(commission_scheduler_loop())
