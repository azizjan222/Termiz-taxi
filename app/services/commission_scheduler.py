"""Deferred-commission background task (group C).

After a driver accepts an order they get a 15-minute window to contact/agree with the
passenger. The commission is charged once that window elapses — whether or not the ride
was completed — UNLESS the driver is on the free trial / active subscription.

A free ride still needs settling when the passenger used a bonus/promo discount: they paid
the driver less cash, and there is no commission to reduce in compensation. This task
therefore also REIMBURSES the driver's balance for that discount, which is what makes the
bonus wallet spendable during the launch free trial instead of silently inert.

This runs as a simple asyncio periodic loop started alongside the API server. It is
intentionally lightweight (no apscheduler dependency wiring needed) and is safe to run
on both SQLite and Postgres.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from app import config
from app.database import get_session
from app.models import Driver, Order

logger = logging.getLogger("sarixgo.commission")

# How often the loop wakes up to look for orders whose window has elapsed.
_POLL_SECONDS = 60


def _subscription_active(driver: Driver, now: datetime) -> bool:
    return bool(driver and driver.subscription_until and driver.subscription_until > now)


def _was_free_when_accepted(driver: Driver, order: Order) -> bool:
    """True if the driver's subscription covered the moment they accepted ``order``.

    The accept endpoint waives every balance requirement for a driver on the free trial, so
    such a driver is never asked to hold funds. Re-checking the subscription only at charge
    time (15 minutes later) meant a trial that lapsed inside that window produced a debit
    against a driver who had been told the ride was free — pushing them negative and then
    locking them out of new orders, with no record of why. Honour the terms the ride was
    accepted under.
    """
    if not driver or not driver.subscription_until or not order.accepted_at:
        return False
    return driver.subscription_until > order.accepted_at


def charge_due_commissions(
    now: datetime | None = None,
    reimbursed_out: list | None = None,
) -> int:
    """Charge commission for accepted orders whose 15-min window has elapsed.

    Returns the number of orders CHARGED. Synchronous (DB only) so it is easy to test.

    ``reimbursed_out``, when given, is appended with one
    ``{"driver_id", "order_id", "amount"}`` dict per free-trial ride whose passenger
    discount was reimbursed, so the async caller can push the driver a notification. It is
    an out-parameter rather than a changed return type because the return value is the
    "charged" count that callers and tests already assert on.
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
            # Commit PER ORDER. A single commit for the whole batch meant one failing row
            # (realistically a duplicate `order:<id>:commission` ledger key, which
            # cancel_by_driver and store.assign_order write too) rolled back EVERY charge
            # in the cycle, so commission silently stopped being collected. It also held
            # every driver's FOR UPDATE lock until the end of the scan, blocking accepts,
            # completions and top-up approvals.
            try:
                # Atomically claim this commission before touching money. Multiple API
                # workers/schedulers may scan the same candidate, but only one can flip
                # the guard from false to true.
                claimed = (
                    session.query(Order)
                    .filter(
                        Order.id == order.id,
                        Order.commission_charged == False,  # noqa: E712
                        Order.status.in_(["accepted", "in_progress", "completed"]),
                    )
                    .update({"commission_charged": True}, synchronize_session=False)
                )
                if not claimed:
                    session.rollback()
                    continue
                session.refresh(order)

                driver = (
                    session.query(Driver)
                    .filter_by(id=order.driver_id)
                    .with_for_update()
                    .first()
                )
                if not driver:
                    # Nothing to charge and nothing to reconcile against; keep the claim so
                    # the order isn't rescanned forever, but say so — a commission silently
                    # written off used to leave no trace at all.
                    logger.warning(
                        "order %s: driver %s is missing, commission written off",
                        order.id, order.driver_id,
                    )
                    session.commit()
                    continue
                if _subscription_active(driver, now) or _was_free_when_accepted(driver, order):
                    # No commission is charged for this ride — so if the passenger got a
                    # bonus/promo discount, reducing a charge settles nothing and the
                    # driver is simply short that much CASH. Pay it back to their balance.
                    #
                    # This is the other half of allowing bonus on a trial driver's ride
                    # (see rewards.reserve_bonus_for_order). Without it the platform would
                    # be funding passenger bonuses out of drivers' pockets; with it the
                    # discount costs the platform the same forgone commission it costs on
                    # a paying ride, only settled as balance credit instead of a smaller
                    # charge. `commission_collected` deliberately stays False so trial
                    # rides keep reporting zero commission revenue.
                    from app.services.rewards import reimburse_discount_for_order
                    reimbursed = reimburse_discount_for_order(session, order, driver)
                    # Keep the claim so a subscribed driver isn't rescanned every cycle.
                    session.commit()
                    if reimbursed and reimbursed_out is not None:
                        reimbursed_out.append({
                            "driver_id": driver.id,
                            "order_id": order.id,
                            "amount": reimbursed,
                        })
                    continue

                from app.services.rewards import debit_commission, effective_commission
                commission = effective_commission(order)
                if commission > 0:
                    # Floors the debit at the available balance and books any shortfall as
                    # a `commission_debt` ledger row, so the wallet can never go negative.
                    charged_now, _debt = debit_commission(
                        session, driver, order, commission,
                        note="Deferred order commission",
                    )
                    # Revenue is only "collected" if money actually moved. A ride that fell
                    # entirely into debt must not report as collected commission.
                    if charged_now:
                        order.commission_collected = True
                    session.commit()
                    charged += 1
                else:
                    # Fully discounted ride: the claim stands (so we stop rescanning) but no
                    # money moved and commission_collected stays False. It used to be
                    # counted as "charged", which made the log overstate collections.
                    session.commit()
            except Exception as order_error:  # pragma: no cover - defensive
                # Skip only the poisoned order; the rest of the batch still gets charged.
                session.rollback()
                logger.error(
                    "charge_due_commissions skipped order %s: %s", order.id, order_error
                )
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
        from app.services.rewards import effective_commission

        # Commit the `commission_warned` flag PER ORDER, mirroring charge_due_commissions.
        # A single commit at the end meant any failure discarded the flags for the whole
        # batch, so the next cycle re-sent every warning the drivers had already received.
        for order in orders:
            driver = session.query(Driver).filter_by(id=order.driver_id).first()
            # No driver, trial/subscription driver, or nothing actually left to charge ->
            # nothing to warn about, but mark handled so we don't re-scan every minute.
            #
            # The zero-check reads the NET amount on purpose. Against gross `commission` a
            # fully discounted ride still triggered a "commission will be charged" warning
            # that was immediately followed by no charge at all.
            due = effective_commission(order)
            if not driver or _subscription_active(driver, now) or due <= 0:
                order.commission_warned = True
                session.commit()
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
                        # Quote what will ACTUALLY be deducted, i.e. net of the
                        # passenger's bonus/promo discount. Sending gross `commission`
                        # here meant the warning and the subsequent balance change
                        # disagreed whenever a discount was in play.
                        "commission": due,
                    })
                except Exception as e:  # pragma: no cover - defensive
                    logger.warning("commission warn WS failed (order %s): %s", order.id, e)

            order.commission_warned = True
            try:
                session.commit()
            except Exception as commit_error:  # pragma: no cover - defensive
                # Don't let one poisoned row cost the whole batch its flags.
                session.rollback()
                logger.error(
                    "warn_due_commissions could not flag order %s: %s",
                    order.id, commit_error,
                )
                continue
            warned += 1
    except Exception as e:  # pragma: no cover - defensive
        session.rollback()
        logger.error(f"warn_due_commissions failed: {e}")
    finally:
        session.close()

    return warned


async def _notify_reimbursements(reimbursed: list) -> None:
    """Push each driver a note about the discount credit added to their balance.

    Best-effort per driver: a failed push must never stop the others, and the money has
    already been committed by this point either way. The credit is also visible in the
    driver's balance history, so this is a courtesy rather than the record of truth.

    Each credit is re-checked first. This runs after the whole batch commits, so a
    cancellation can land in between and reverse a credit we are about to announce —
    telling a driver "+5 000 added, you lose nothing" about money that is already gone is
    worse than saying nothing, since the cancel path sends its own reversal notice.
    """
    from app.services.push import notify_driver_discount_reimbursed
    from app.services.rewards import reimbursement_is_reversed

    session = get_session()
    try:
        for item in reimbursed:
            order_id = item["order_id"]
            try:
                if reimbursement_is_reversed(session, order_id):
                    logger.info(
                        "Skipping reimbursement push for order %s: already reversed", order_id,
                    )
                    continue
                await notify_driver_discount_reimbursed(
                    session, item["driver_id"], item["amount"], order_id,
                )
            except Exception as e:  # pragma: no cover - defensive
                logger.warning(
                    "discount reimbursement push failed (order %s): %s", order_id, e,
                )
    finally:
        session.close()


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
            reimbursed: list = []
            n = await asyncio.to_thread(charge_due_commissions, None, reimbursed)
            if n:
                logger.info("Charged commission for %s order(s)", n)
            # 3) Tell trial drivers about balance credits they'd otherwise see appear with
            #    no explanation. Sent from the async loop because charge_due_commissions is
            #    a sync DB function running in a worker thread.
            if reimbursed:
                logger.info("Reimbursed passenger discounts on %s order(s)", len(reimbursed))
                await _notify_reimbursements(reimbursed)
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
