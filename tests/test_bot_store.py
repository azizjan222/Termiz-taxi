"""Tests for the DB-backed bot store (app.bot.store.BotStore).

These cover the money-critical order lifecycle that used to live in the JSON-backed
monolith: creating a bot order, a driver accepting it (fare reserved from balance),
completing it, and the two cancellation paths (with/without refund). They also cover
the single-winner guarantee on concurrent accepts, plus the Setting-backed collections
(ban list, maintenance flag, first-payment set, passengers).
"""
from app import config
from app.bot.store import BotStore
from app.models import Driver, OrderHistory


def _make_driver(db, telegram_id=1001, phone="+998901112233", balance=100000):
    d = Driver(telegram_id=telegram_id, phone=phone, balance=balance,
               first_name="Ali", last_name="Valiyev")
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def test_register_and_balance(db):
    store = BotStore()
    store.register_driver(2001, "+998901234567", first_name="Bek")
    assert store.is_driver(2001) is True
    assert store.get_driver_phone(2001) == "+998901234567"
    assert store.get_balance(2001) == 0

    assert store.add_balance(2001, 50000) == 50000
    assert store.add_balance(2001, 10000) == 60000
    assert store.get_balance(2001) == 60000


def test_register_reuses_row_matched_by_phone(db):
    # A synthetic driver row keyed only by phone (telegram_id placeholder) gets relinked.
    d = Driver(telegram_id=999999, phone="+998907465161", balance=15000)
    db.add(d)
    db.commit()

    store = BotStore()
    store.register_driver(5005, "+998 90 746 51 61", first_name="Test")

    # The store committed via its own session; drop this session's cached copy so we
    # read the freshly-persisted row instead of the stale identity-map object.
    db.expire_all()
    # No duplicate row was created; the existing one was relinked to the real tg id.
    assert db.query(Driver).count() == 1
    relinked = db.query(Driver).first()
    assert relinked.telegram_id == 5005
    assert relinked.balance == 15000  # balance preserved


def test_order_lifecycle_accept_and_complete(db):
    store = BotStore()
    _make_driver(db, balance=100000)

    order = store.create_order(
        passenger_telegram_id=7001, passenger_name="Yo'lovchi",
        passenger_phone="+998935556677", from_city="Termiz", to_city="Sariosiyo",
        person_count=2, departure_time="Hozir",
    )
    assert order.status == "new"
    assert order.source == "bot"
    assert order.price == 2 * config.COMMISSION_PER_PERSON

    res = store.assign_order(order.id, 1001)
    assert res.ok is True
    assert res.new_balance == 100000 - order.price
    assert store.get_balance(1001) == 100000 - order.price

    completed = store.complete_order(order.id, actor="Ali", actor_phone="+998901112233")
    assert completed.status == "completed"
    # No refund on completion -> balance unchanged.
    assert store.get_balance(1001) == 100000 - order.price
    assert db.query(OrderHistory).filter_by(action="completed").count() == 1


def test_accept_refunds_on_driver_cancel(db):
    store = BotStore()
    _make_driver(db, balance=100000)
    order = store.create_order(
        passenger_telegram_id=7002, passenger_name="P", passenger_phone="+998900000000",
        from_city="A", to_city="B", person_count=1, departure_time="Hozir",
    )
    store.assign_order(order.id, 1001)
    assert store.get_balance(1001) == 100000 - config.COMMISSION_PER_PERSON

    cancelled, refunded = store.cancel_order(order.id, cancelled_by="driver", actor="Ali")
    assert cancelled.status == "cancelled"
    assert refunded is True
    assert store.get_balance(1001) == 100000  # fully refunded


def test_cancel_new_order_no_refund(db):
    store = BotStore()
    _make_driver(db, balance=100000)
    order = store.create_order(
        passenger_telegram_id=7003, passenger_name="P", passenger_phone="+998900000001",
        from_city="A", to_city="B", person_count=1, departure_time="Hozir",
    )
    # Never accepted -> nothing to refund.
    cancelled, refunded = store.cancel_order(order.id, cancelled_by="passenger")
    assert cancelled.status == "cancelled"
    assert refunded is False
    assert store.get_balance(1001) == 100000


def test_assign_rejected_when_balance_too_low(db):
    store = BotStore()
    _make_driver(db, balance=5000)  # below one seat's price
    order = store.create_order(
        passenger_telegram_id=7004, passenger_name="P", passenger_phone="+998900000002",
        from_city="A", to_city="B", person_count=1, departure_time="Hozir",
    )
    res = store.assign_order(order.id, 1001)
    assert res.ok is False
    assert res.reason == "low_balance"
    # Order stays available, balance untouched.
    assert store.get_order(order.id).status == "new"
    assert store.get_balance(1001) == 5000


def test_only_one_driver_wins(db):
    store = BotStore()
    _make_driver(db, telegram_id=1001, phone="+998901112233", balance=100000)
    _make_driver(db, telegram_id=1002, phone="+998904445566", balance=100000)
    order = store.create_order(
        passenger_telegram_id=7005, passenger_name="P", passenger_phone="+998900000003",
        from_city="A", to_city="B", person_count=1, departure_time="Hozir",
    )
    first = store.assign_order(order.id, 1001)
    second = store.assign_order(order.id, 1002)
    assert first.ok is True
    assert second.ok is False
    assert second.reason == "taken"
    # Second driver was never charged.
    assert store.get_balance(1002) == 100000


def test_ban_unban_and_maintenance(db):
    store = BotStore()
    assert store.is_banned(42) is False
    store.ban(42)
    assert store.is_banned(42) is True
    assert 42 in store.list_banned_ids()
    store.unban(42)
    assert store.is_banned(42) is False

    assert store.is_maintenance() is False
    store.set_maintenance(True)
    assert store.is_maintenance() is True
    store.set_maintenance(False)
    assert store.is_maintenance() is False


def test_first_payment_and_passengers(db):
    store = BotStore()
    assert store.has_first_payment(9) is False
    store.mark_first_payment(9)
    assert store.has_first_payment(9) is True

    store.add_passenger(9)
    store.add_passenger(9)  # idempotent
    store.add_passenger(10)
    assert store.count_passengers() == 2
    assert store.list_passenger_ids() == [9, 10]


def test_history_counts_and_recent(db):
    store = BotStore()
    _make_driver(db, balance=100000)
    order = store.create_order(
        passenger_telegram_id=7006, passenger_name="P", passenger_phone="+998900000004",
        from_city="Termiz", to_city="Denov", person_count=1, departure_time="Hozir",
    )
    store.assign_order(order.id, 1001)
    store.complete_order(order.id, actor="Ali")

    today, total = store.history_counts("completed")
    assert total == 1
    assert today == 1
    recent = store.recent_history("completed", limit=5)
    assert len(recent) == 1
    assert recent[0]["from_city"] == "Termiz"
    assert recent[0]["to_city"] == "Denov"
