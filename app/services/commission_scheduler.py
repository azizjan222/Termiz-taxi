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
            order.commission_charged = True
            charged += 1

        session.commit()
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"charge_due_commissions failed: {e}")
    finally:
        session.close()

    return charged


async def commission_scheduler_loop(stop_event: asyncio.Event | None = None):
    """Periodically charge due commissions until stop_event is set (or forever)."""
    logger.info(
        "Commission scheduler started (window=%s min, poll=%ss)",
        config.COMMISSION_WINDOW_MINUTES, _POLL_SECONDS,
    )
    while True:
        try:
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
