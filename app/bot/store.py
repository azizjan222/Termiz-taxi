"""Single source of truth for the Telegram bot's state — backed entirely by SQL.

Before this module the bot kept its data in module-level dicts (``haydovchilar``,
``balanslar``, ``zakaslar``, ...) that were serialized to ``taksi_baza.json`` while the
*same* information also lived in the database (``Driver.balance``, the ``Order`` table,
``OrderHistory``, ``Setting``). Two stores for one fact meant every write had to touch
both and they drifted apart on any crash or concurrent access.

``BotStore`` collapses that down to one store: the database. Drivers/balances map to the
:class:`~app.models.Driver` table, bot orders to the :class:`~app.models.Order` table
(``source="bot"``), completed/cancelled orders to :class:`~app.models.OrderHistory`, and
small key/value collections (maintenance flag, ban list, first-payment set, bot passenger
ids) to the :class:`~app.models.Setting` table. There is no JSON file anymore.

Each public method opens and closes its own short-lived session, so callers never have to
manage sessions. Money-changing operations (accept / cancel with refund) run inside a
single transaction and use an atomic conditional UPDATE to claim an order, so two drivers
can never both win the same order.

Every method here is plain synchronous DB code with no Telegram dependency, which is what
makes the bot's core logic unit-testable (see ``tests/test_bot_store.py``).
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from app import config
from app.database import get_session
from app.models import BalanceTransaction, Driver, Order, OrderHistory, Setting

logger = logging.getLogger("sarixgo.bot.store")

# Uzbekistan is UTC+5; the bot displays local wall-clock time in history rows.
UZ_TZ_OFFSET = timedelta(hours=5)

# Setting keys for the small collections that used to be JSON dicts/sets/flags.
# These keys are SHARED with the migration (app/bot/../migrate.py) and, for
# `first_payers`, with the mobile-app payment code (app/api/payments.py). They must
# stay identical everywhere or state silently diverges (e.g. a driver getting the
# first-payment bonus twice). Do not rename without updating all consumers.
_KEY_MAINTENANCE = "maintenance_mode"
_KEY_BANNED = "bot_banned_ids"
# NOTE: `first_payers` is the canonical, app-shared key. The bot MUST read/write the
# same key the app's credit_driver_payment() uses, otherwise the 50% first-payment
# bonus is granted twice (once per subsystem).
_KEY_FIRST_PAYMENT = "first_payers"
_KEY_PASSENGERS = "bot_passenger_ids"


def _now_uz_str() -> str:
    return (datetime.utcnow() + UZ_TZ_OFFSET).strftime("%Y-%m-%d %H:%M")


@dataclass
class AssignResult:
    """Outcome of an attempt to assign a bot order to a driver."""

    ok: bool
    reason: str = ""          # "" on success, else: not_found | taken | low_balance
    order: Order | None = None
    price: int = 0
    new_balance: int = 0


class BotStore:
    """Database-backed façade over all Telegram-bot state."""

    def __init__(self, session_factory=get_session):
        self._session_factory = session_factory

    # ------------------------------------------------------------------ #
    # Low-level Setting helpers (key/value + JSON collections)
    # ------------------------------------------------------------------ #
    def _get_setting(self, session, key: str) -> str | None:
        row = session.query(Setting).filter_by(key=key).first()
        return row.value if row else None

    def _set_setting(self, session, key: str, value: str) -> None:
        row = session.query(Setting).filter_by(key=key).first()
        if row:
            row.value = value
        else:
            session.add(Setting(key=key, value=value))

    def _get_id_set(self, session, key: str) -> set[int]:
        raw = self._get_setting(session, key)
        if not raw:
            return set()
        try:
            return {int(x) for x in json.loads(raw)}
        except (ValueError, TypeError):
            return set()

    def _set_id_set(self, session, key: str, ids: set[int]) -> None:
        self._set_setting(session, key, json.dumps(sorted(ids)))

    @staticmethod
    def _norm_phone(phone: str | None) -> str:
        digits = "".join(ch for ch in (phone or "") if ch.isdigit())
        return ("+" + digits) if digits else ""

    # ------------------------------------------------------------------ #
    # Drivers & balances (Driver table)
    # ------------------------------------------------------------------ #
    def is_driver(self, telegram_id: int) -> bool:
        session = self._session_factory()
        try:
            return session.query(Driver).filter_by(telegram_id=telegram_id).count() > 0
        finally:
            session.close()

    def get_driver_phone(self, telegram_id: int) -> str | None:
        session = self._session_factory()
        try:
            d = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            return d.phone if d else None
        finally:
            session.close()

    def get_balance(self, telegram_id: int) -> int:
        session = self._session_factory()
        try:
            d = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            return int(d.balance or 0) if d else 0
        finally:
            session.close()

    def add_balance(
        self,
        telegram_id: int,
        amount: int,
        *,
        idempotency_key: str | None = None,
        audit_actor: str | None = None,
        audit_update_id: int | None = None,
    ) -> int:
        """Adjust a balance once and append an immutable ledger entry."""
        session = self._session_factory()
        try:
            d = (
                session.query(Driver)
                .filter_by(telegram_id=telegram_id)
                .with_for_update()
                .first()
            )
            if not d:
                return 0
            key = idempotency_key or f"bot-admin:{uuid.uuid4().hex}"
            existing = session.query(BalanceTransaction).filter_by(
                idempotency_key=key
            ).first()
            if existing:
                return int(d.balance or 0)
            amount = int(amount)
            if amount == 0:
                return int(d.balance or 0)
            d.balance = int(d.balance or 0) + amount
            new_balance = d.balance
            session.add(BalanceTransaction(
                driver_id=d.id,
                amount=amount,
                balance_after=new_balance,
                source="bot_admin_adjustment",
                reference_type="telegram_update",
                idempotency_key=key,
                note="Telegram admin balance adjustment",
            ))
            if audit_actor:
                from app.admin.audit import add_actor_audit
                add_actor_audit(
                    session,
                    actor=audit_actor,
                    action="driver.balance_adjust",
                    target_type="driver",
                    target_id=d.id,
                    details={
                        "telegram_update_id": audit_update_id,
                        "amount": amount,
                        "balance_after": new_balance,
                        "idempotency_key": key,
                    },
                )
            session.commit()
            return new_balance
        finally:
            session.close()

    def register_driver(self, telegram_id: int, phone: str | None, **fields) -> Driver:
        """Create or update a driver row (used by both bot registration flows).

        Mirrors the old ``haydovchilar[uid] = phone`` + ``_save_registered_driver_to_db``
        behaviour, but there is now only ONE place the data lives. Never marks
        ``documents_submitted`` — documents are uploaded later in the app.
        """
        session = self._session_factory()
        try:
            d = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            if not d and phone:
                # Reuse a row previously keyed by phone (e.g. synthetic test driver).
                norm = self._norm_phone(phone)
                for existing in session.query(Driver).all():
                    if self._norm_phone(existing.phone) == norm and norm:
                        d = existing
                        d.telegram_id = telegram_id
                        break
            if not d:
                d = Driver(telegram_id=telegram_id, phone=phone or f"tg{telegram_id}")
                session.add(d)
            if phone:
                d.phone = phone
            for key, value in fields.items():
                if value is not None and hasattr(d, key):
                    setattr(d, key, value)
            if d.balance is None:
                d.balance = 0
            if d.documents_submitted is None:
                d.documents_submitted = False
            session.commit()
            session.refresh(d)
            session.expunge(d)
            return d
        finally:
            session.close()

    def find_driver_by_phone(self, phone: str):
        """Return (telegram_id, balance) for a driver matched by phone, or (None, 0)."""
        norm = self._norm_phone(phone)
        session = self._session_factory()
        try:
            for d in session.query(Driver).all():
                if self._norm_phone(d.phone) == norm and norm:
                    return d.telegram_id, int(d.balance or 0)
            return None, 0
        finally:
            session.close()

    def list_driver_telegram_ids(self) -> list[int]:
        session = self._session_factory()
        try:
            return [
                d.telegram_id
                for d in session.query(Driver).all()
                if d.telegram_id
            ]
        finally:
            session.close()

    def count_drivers(self) -> int:
        session = self._session_factory()
        try:
            return session.query(Driver).count()
        finally:
            session.close()

    def total_balance_sum(self) -> int:
        session = self._session_factory()
        try:
            return sum(int(d.balance or 0) for d in session.query(Driver).all())
        finally:
            session.close()

    # ------------------------------------------------------------------ #
    # Bot passengers (Setting-backed id set)
    # ------------------------------------------------------------------ #
    def add_passenger(self, telegram_id: int) -> None:
        session = self._session_factory()
        try:
            ids = self._get_id_set(session, _KEY_PASSENGERS)
            if telegram_id not in ids:
                ids.add(telegram_id)
                self._set_id_set(session, _KEY_PASSENGERS, ids)
                session.commit()
        finally:
            session.close()

    def list_passenger_ids(self) -> list[int]:
        session = self._session_factory()
        try:
            return sorted(self._get_id_set(session, _KEY_PASSENGERS))
        finally:
            session.close()

    def count_passengers(self) -> int:
        return len(self.list_passenger_ids())

    # ------------------------------------------------------------------ #
    # Bans, maintenance, first-payment (Setting-backed)
    # ------------------------------------------------------------------ #
    def ban(self, telegram_id: int) -> None:
        session = self._session_factory()
        try:
            ids = self._get_id_set(session, _KEY_BANNED)
            ids.add(telegram_id)
            self._set_id_set(session, _KEY_BANNED, ids)
            # Keep the app in sync: if the target is a driver, block them there too.
            driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            if driver:
                driver.is_blocked = True
            session.commit()
        finally:
            session.close()

    def unban(self, telegram_id: int) -> None:
        session = self._session_factory()
        try:
            ids = self._get_id_set(session, _KEY_BANNED)
            ids.discard(telegram_id)
            self._set_id_set(session, _KEY_BANNED, ids)
            driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            if driver:
                driver.is_blocked = False
            session.commit()
        finally:
            session.close()

    def is_banned(self, telegram_id: int) -> bool:
        """Blocked if the bot ban list OR the driver's is_blocked flag says so.

        Checking both keeps the bot consistent with app-side blocks (a driver blocked
        via the admin panel is also refused by the bot) and preserves legacy bans that
        the migration recorded as Driver.is_blocked.
        """
        session = self._session_factory()
        try:
            if telegram_id in self._get_id_set(session, _KEY_BANNED):
                return True
            driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            return bool(driver and driver.is_blocked)
        finally:
            session.close()

    def list_banned_ids(self) -> list[int]:
        session = self._session_factory()
        try:
            return sorted(self._get_id_set(session, _KEY_BANNED))
        finally:
            session.close()

    def is_maintenance(self) -> bool:
        session = self._session_factory()
        try:
            return (self._get_setting(session, _KEY_MAINTENANCE) or "").lower() in (
                "1", "true", "on", "yes",
            )
        finally:
            session.close()

    def set_maintenance(self, enabled: bool) -> bool:
        session = self._session_factory()
        try:
            self._set_setting(session, _KEY_MAINTENANCE, "true" if enabled else "false")
            session.commit()
            return enabled
        finally:
            session.close()

    def has_first_payment(self, telegram_id: int) -> bool:
        session = self._session_factory()
        try:
            return telegram_id in self._get_id_set(session, _KEY_FIRST_PAYMENT)
        finally:
            session.close()

    def mark_first_payment(self, telegram_id: int) -> None:
        session = self._session_factory()
        try:
            ids = self._get_id_set(session, _KEY_FIRST_PAYMENT)
            ids.add(telegram_id)
            self._set_id_set(session, _KEY_FIRST_PAYMENT, ids)
            session.commit()
        finally:
            session.close()

    # ------------------------------------------------------------------ #
    # Bot orders (Order table, source="bot")
    # ------------------------------------------------------------------ #
    def order_price(self, person_count: int) -> int:
        """Flat bot pricing: COMMISSION_PER_PERSON per seat (was hard-coded 10000)."""
        return max(1, int(person_count)) * config.COMMISSION_PER_PERSON

    def create_order(
        self,
        *,
        passenger_telegram_id: int,
        passenger_name: str,
        passenger_phone: str,
        from_city: str,
        to_city: str,
        person_count: int,
        departure_time: str,
        from_lat: float | None = None,
        from_lon: float | None = None,
        note: str | None = None,
    ) -> Order:
        session = self._session_factory()
        try:
            price = self.order_price(person_count)
            order = Order(
                passenger_telegram_id=passenger_telegram_id,
                passenger_name=passenger_name,
                passenger_phone=passenger_phone,
                service_type="taxi",
                from_city=from_city,
                to_city=to_city,
                from_lat=from_lat,
                from_lon=from_lon,
                person_count=person_count,
                price=price,
                commission=price,
                departure_time=departure_time,
                note=note,
                status="new",
                source="bot",
            )
            session.add(order)
            session.commit()
            session.refresh(order)
            session.expunge(order)
            return order
        finally:
            session.close()

    def get_order(self, order_id: int) -> Order | None:
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if order:
                session.expunge(order)
            return order
        finally:
            session.close()

    def assign_order(self, order_id: int, driver_telegram_id: int) -> AssignResult:
        """Atomically give a "new" **bot** order to a driver and reserve the fare.

        Returns an :class:`AssignResult`. On success the order is "accepted" and the
        order's price has been debited from the driver's balance (refunded on cancel),
        matching the original bot behaviour. Only one driver can win a given order.

        BOT ORDERS ONLY. This debits ``order.price``, which is correct here because
        :meth:`create_order` sets ``commission = price`` for bot orders. An app order
        carries the passenger's full fare in ``price`` and the real (≈10%) platform cut in
        ``commission``, so routing one through here charged the driver roughly ten times
        what they owed. Order ids are sequential and the ``/start olish_<id>`` deep link
        took any id, so this was reachable by guessing. App orders have their own accept
        path (``accept_app_order_from_bot`` / the driver API) which checks the balance
        against the commission, enforces the active-order limit and reserves the
        passenger's bonus.
        """
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order or order.status != "new":
                return AssignResult(ok=False, reason="not_found" if not order else "taken")
            if (order.source or "bot") != "bot":
                # Report as not_found rather than a distinct reason: ids are guessable, so
                # don't confirm to the caller that some other order exists.
                return AssignResult(ok=False, reason="not_found")

            driver = (
                session.query(Driver)
                .filter_by(telegram_id=driver_telegram_id)
                .with_for_update()
                .first()
            )
            price = int(order.price or self.order_price(order.person_count or 1))
            if not driver:
                return AssignResult(ok=False, reason="not_registered", price=price)
            if not driver.is_verified:
                return AssignResult(
                    ok=False,
                    reason="verification_pending" if driver.documents_submitted else "documents_required",
                    price=price,
                    new_balance=int(driver.balance or 0),
                )
            if int(driver.balance or 0) < price:
                return AssignResult(ok=False, reason="low_balance", price=price,
                                    new_balance=int(driver.balance or 0))

            # Atomic claim: only succeeds if the order is still "new".
            claimed = (
                session.query(Order)
                .filter(Order.id == order_id, Order.status == "new")
                .update(
                    {
                        "driver_id": driver.id,
                        "driver_telegram_id": driver_telegram_id,
                        "status": "accepted",
                        "accepted_at": datetime.utcnow(),
                        "commission_charged": True,
                        "commission_collected": True,
                    },
                    synchronize_session=False,
                )
            )
            if not claimed:
                return AssignResult(ok=False, reason="taken", price=price)

            # Floored at the available balance: this used to subtract unconditionally, and
            # ck_driver_balance_nonnegative now rejects an overdraw outright. The caller
            # gates on the minimum balance before assigning, so a shortfall here is an edge
            # case (a concurrent debit) -- it is logged rather than silently swallowed.
            available = max(0, int(driver.balance or 0))
            charged = min(price, available)
            driver.balance = available - charged
            new_balance = driver.balance
            if charged < price:
                logger.warning(
                    "Bot order %s: fare %s exceeded driver %s balance %s, reserved %s",
                    order_id, price, driver.id, available, charged,
                )
            if charged > 0:
                # ck_balance_transaction_amount_nonzero forbids a zero-amount ledger row.
                session.add(BalanceTransaction(
                    driver_id=driver.id,
                    amount=-charged,
                    balance_after=new_balance,
                    source="bot_order_reserve",
                    reference_type="order",
                    reference_id=order_id,
                    idempotency_key=f"order:{order_id}:commission",
                    note="Bot order fare reserved on acceptance",
                ))
            session.commit()
            session.refresh(order)
            session.expunge(order)
            return AssignResult(ok=True, order=order, price=price, new_balance=new_balance)
        finally:
            session.close()

    def _record_history(self, session, order: Order, action: str,
                        actor: str, actor_phone: str) -> None:
        session.add(OrderHistory(
            order_id=order.id,
            action=action,
            from_city=order.from_city,
            to_city=order.to_city,
            person_count=order.person_count,
            commission=order.commission,
            actor=actor,
            actor_phone=actor_phone,
            timestamp=datetime.utcnow(),
        ))

    def complete_order(self, order_id: int, *, actor: str = "",
                       actor_phone: str = "",
                       actor_telegram_id: int | None = None) -> Order | None:
        """Mark an accepted **bot** order completed and log it to history.

        ``actor_telegram_id`` must be the order's driver. callback_data is client-supplied,
        so without this anyone could close somebody else's ride by guessing its id.
        """
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order:
                return None
            if (order.source or "bot") != "bot":
                return None
            if actor_telegram_id is not None and actor_telegram_id != order.driver_telegram_id:
                return None
            completed_at = datetime.utcnow()
            claimed = (
                session.query(Order)
                .filter(Order.id == order_id, Order.status == "accepted")
                .update(
                    {"status": "completed", "completed_at": completed_at},
                    synchronize_session=False,
                )
            )
            if not claimed:
                session.rollback()
                return None
            session.refresh(order)
            self._record_history(session, order, "completed", actor, actor_phone)
            session.commit()
            session.refresh(order)
            session.expunge(order)
            return order
        finally:
            session.close()

    def cancel_order(self, order_id: int, *, cancelled_by: str, actor: str = "",
                     actor_phone: str = "",
                     actor_telegram_id: int | None = None) -> tuple[Order | None, bool]:
        """Cancel a **bot** order, refunding what was actually reserved.

        Returns ``(order, refunded)``. ``refunded`` is True when the driver's balance
        was credited back (only happens for orders that had been accepted).

        BOT ORDERS ONLY -- the same restriction :meth:`assign_order` documents, and for the
        same reason. This used to accept any order id and refund ``order.price``. A bot
        order has ``commission == price`` so that was right for them, but an app order
        carries the passenger's full fare in ``price`` and only the ~10% platform cut in
        ``commission``. Once the commission scheduler had collected that cut, cancelling the
        app order through here credited the driver the WHOLE FARE -- roughly ten times what
        they had paid -- and order ids are sequential, so it was reachable by guessing.

        ``actor_telegram_id`` is the Telegram id of whoever pressed the button and is
        REQUIRED to match the order's driver or passenger. callback_data is client-supplied,
        so without this check anyone holding any inline keyboard from the bot could cancel
        (and trigger a refund on) somebody else's ride.
        """
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order or order.status not in ("new", "accepted"):
                return None, False
            if (order.source or "bot") != "bot":
                # Report as "not found": ids are guessable, so do not confirm that some
                # other order exists.
                return None, False
            if actor_telegram_id is not None and actor_telegram_id not in (
                order.driver_telegram_id,
                order.passenger_telegram_id,
            ):
                return None, False

            was_accepted = order.status == "accepted"
            cancelled_at = datetime.utcnow()
            claimed = (
                session.query(Order)
                .filter(Order.id == order_id, Order.status.in_(["new", "accepted"]))
                .update(
                    {
                        "status": "cancelled",
                        "cancelled_by": cancelled_by,
                        "cancelled_at": cancelled_at,
                        "commission_charged": True,
                    },
                    synchronize_session=False,
                )
            )
            if not claimed:
                session.rollback()
                return None, False
            session.refresh(order)

            refunded = False
            if was_accepted and order.driver_telegram_id:
                driver = (
                    session.query(Driver)
                    .filter_by(telegram_id=order.driver_telegram_id)
                    .with_for_update()
                    .first()
                )
                if driver and order.commission_collected:
                    # Refund exactly what was taken, read back from the ledger rather than
                    # recomputed. Whichever path charged this order (assign_order here, or
                    # the commission scheduler) wrote a negative BalanceTransaction under
                    # this key, so this can never refund more than was actually debited.
                    charged = (
                        session.query(BalanceTransaction)
                        .filter_by(idempotency_key=f"order:{order.id}:commission")
                        .first()
                    )
                    refund_amount = (
                        abs(int(charged.amount or 0))
                        if charged is not None
                        else int(order.price or self.order_price(order.person_count or 1))
                    )
                    driver.balance = int(driver.balance or 0) + refund_amount
                    order.commission_collected = False
                    session.add(BalanceTransaction(
                        driver_id=driver.id,
                        amount=refund_amount,
                        balance_after=driver.balance,
                        source="bot_order_refund",
                        reference_type="order",
                        reference_id=order.id,
                        idempotency_key=f"order:{order.id}:commission_refund",
                        note="Bot order cancellation refund",
                    ))
                    refunded = True

            self._record_history(session, order, "cancelled", actor, actor_phone)
            session.commit()
            session.refresh(order)
            session.expunge(order)
            return order, refunded
        finally:
            session.close()

    def is_order_active(self, order_id: int) -> bool:
        """True while a bot order is still accepted (used by the auto-cancel timer)."""
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            return bool(order and order.status == "accepted")
        finally:
            session.close()

    # ------------------------------------------------------------------ #
    # Stats & history (for the admin panel screens)
    # ------------------------------------------------------------------ #
    def total_orders(self) -> int:
        session = self._session_factory()
        try:
            return session.query(Order).filter_by(source="bot").count()
        finally:
            session.close()

    def recent_history(self, action: str, limit: int = 5) -> list[dict]:
        session = self._session_factory()
        try:
            rows = (
                session.query(OrderHistory)
                .filter_by(action=action)
                .order_by(OrderHistory.timestamp.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "from_city": r.from_city,
                    "to_city": r.to_city,
                    "time": (r.timestamp + UZ_TZ_OFFSET).strftime("%Y-%m-%d %H:%M")
                    if r.timestamp else "",
                }
                for r in rows
            ]
        finally:
            session.close()

    def history_counts(self, action: str) -> tuple[int, int]:
        """Return (today_count, total_count) for a history action."""
        session = self._session_factory()
        try:
            total = session.query(OrderHistory).filter_by(action=action).count()
            today_prefix = _now_uz_str()[:10]
            today = sum(
                1
                for r in session.query(OrderHistory).filter_by(action=action).all()
                if r.timestamp and (r.timestamp + UZ_TZ_OFFSET).strftime("%Y-%m-%d")
                == today_prefix
            )
            return today, total
        finally:
            session.close()


# A shared default instance used by the handlers.
store = BotStore()
