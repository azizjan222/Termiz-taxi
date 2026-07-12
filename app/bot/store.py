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
from dataclasses import dataclass
from datetime import datetime, timedelta

from app import config
from app.database import get_session
from app.models import Driver, Order, OrderHistory, Setting

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

    def add_balance(self, telegram_id: int, amount: int) -> int:
        """Credit (or debit, if negative) a driver's balance. Returns the new balance."""
        session = self._session_factory()
        try:
            d = session.query(Driver).filter_by(telegram_id=telegram_id).first()
            if not d:
                return 0
            d.balance = int(d.balance or 0) + int(amount)
            new_balance = d.balance
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
        """Atomically give a "new" bot order to a driver and reserve the fare.

        Returns an :class:`AssignResult`. On success the order is "accepted" and the
        order's price has been debited from the driver's balance (refunded on cancel),
        matching the original bot behaviour. Only one driver can win a given order.
        """
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order or order.status != "new":
                return AssignResult(ok=False, reason="not_found" if not order else "taken")

            driver = session.query(Driver).filter_by(telegram_id=driver_telegram_id).first()
            price = int(order.price or self.order_price(order.person_count or 1))
            if not driver or int(driver.balance or 0) < price:
                return AssignResult(ok=False, reason="low_balance", price=price,
                                    new_balance=int(driver.balance or 0) if driver else 0)

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
                    },
                    synchronize_session=False,
                )
            )
            if not claimed:
                return AssignResult(ok=False, reason="taken", price=price)

            driver.balance = int(driver.balance or 0) - price
            new_balance = driver.balance
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
                       actor_phone: str = "") -> Order | None:
        """Mark an accepted bot order completed and log it to history."""
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order or order.status != "accepted":
                return None
            order.status = "completed"
            order.completed_at = datetime.utcnow()
            self._record_history(session, order, "completed", actor, actor_phone)
            session.commit()
            session.refresh(order)
            session.expunge(order)
            return order
        finally:
            session.close()

    def cancel_order(self, order_id: int, *, cancelled_by: str, actor: str = "",
                     actor_phone: str = "") -> tuple[Order | None, bool]:
        """Cancel a bot order, refunding the reserved fare if it was accepted.

        Returns ``(order, refunded)``. ``refunded`` is True when the driver's balance
        was credited back (only happens for orders that had been accepted).
        """
        session = self._session_factory()
        try:
            order = session.query(Order).filter_by(id=order_id).first()
            if not order or order.status in ("completed", "cancelled", "expired"):
                return None, False

            refunded = False
            if order.status == "accepted" and order.driver_telegram_id:
                driver = session.query(Driver).filter_by(
                    telegram_id=order.driver_telegram_id).first()
                if driver:
                    driver.balance = int(driver.balance or 0) + int(
                        order.price or self.order_price(order.person_count or 1))
                    refunded = True

            order.status = "cancelled"
            order.cancelled_by = cancelled_by
            order.cancelled_at = datetime.utcnow()
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
