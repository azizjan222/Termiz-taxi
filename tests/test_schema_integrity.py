"""Schema integrity: declared constraints must be real, and commission must not overdraw.

Two regressions are locked in here.

1. Every table-level constraint declared in ``models.py`` used to exist ONLY on freshly
   created databases. ``create_all()`` builds whole tables and the additive migration pass
   only adds columns, so nothing ever backfilled a CheckConstraint or ``idx_route_pair``
   into an existing deployment. The test suite created its schema with ``create_all()``, so
   it validated a schema production did not have. ``_declared_constraints()`` now generates
   the DDL from ``Base.metadata``, and the drift test below fails if a declared constraint
   stops being reachable by the migration.

2. ``Driver.balance`` had no ``>= 0`` constraint (the passenger wallet always had one) and
   the two commission debits were unconditional, so a driver holding several rides could be
   debited once per ride and go negative -- leaving uncollectable debt with nothing
   recording it.
"""
from datetime import datetime, timedelta

import pytest

from app.migrate import _declared_constraints
from app.models import BalanceTransaction, Driver, Order
from app.services.rewards import (
    COMMISSION_DEBT_SOURCE,
    COMMISSION_SOURCE,
    debit_commission,
)


# --------------------------------------------------------------------------- #
# 1. Declared-constraint coverage                                              #
# --------------------------------------------------------------------------- #

def test_every_declared_constraint_is_backfillable():
    """No declared CHECK/UNIQUE/index may be invisible to the migration.

    This is the drift guard: it is what makes it impossible to add a constraint to a model
    and silently ship a production database without it.
    """
    from sqlalchemy import CheckConstraint, UniqueConstraint

    from app.models import Base

    generated = {name for _table, name, _ddl, _v in _declared_constraints()}

    declared = set()
    for table in Base.metadata.sorted_tables:
        for constraint in table.constraints:
            if isinstance(constraint, (CheckConstraint, UniqueConstraint)) and constraint.name:
                declared.add(constraint.name)
        for index in table.indexes:
            if index.name:
                declared.add(index.name)

    missing = sorted(declared - generated)
    assert not missing, f"declared but not backfilled by the migration: {missing}"


def test_constraint_ddl_and_violation_probe_are_wellformed():
    """Each CHECK must yield an ALTER ... ADD CONSTRAINT plus a counting probe."""
    checks = {
        name: (ddl, violation)
        for _t, name, ddl, violation in _declared_constraints()
        if violation is not None
    }

    # A representative money constraint and the status enum must both be present.
    assert "ck_driver_balance_nonnegative" in checks
    assert "ck_order_discounts_within_commission" in checks
    assert "ck_order_status" in checks

    ddl, violation = checks["ck_driver_balance_nonnegative"]
    assert ddl.upper().startswith("ALTER TABLE")
    assert "ADD CONSTRAINT" in ddl.upper()
    assert violation.upper().startswith("SELECT COUNT(*)")
    assert "WHERE NOT (" in violation.upper()


def test_route_pair_unique_index_is_backfilled():
    """Duplicate routes make pricing arbitrary, because _calc_price uses .first()."""
    entries = {name: ddl for _t, name, ddl, _v in _declared_constraints()}
    assert "idx_route_pair" in entries
    ddl = entries["idx_route_pair"].upper()
    assert "UNIQUE" in ddl and "IF NOT EXISTS" in ddl


def test_backfill_is_a_noop_off_postgres():
    """SQLite cannot ADD CONSTRAINT, and create_all() already gave it everything."""
    from app.migrate import _backfill_declared_constraints

    assert _backfill_declared_constraints({"drivers", "orders"}) == 0


# --------------------------------------------------------------------------- #
# 2. Commission must never overdraw the wallet                                 #
# --------------------------------------------------------------------------- #

@pytest.fixture
def driver(db):
    d = Driver(telegram_id=5001, phone="+998900000001", first_name="Test", balance=0)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def _order(db, driver, commission: int) -> Order:
    order = Order(
        service_type="taxi",
        from_city="Termiz",
        to_city="Sariosiyo",
        person_count=1,
        price=commission * 10,
        commission=commission,
        status="completed",
        driver_id=driver.id,
        accepted_at=datetime.utcnow() - timedelta(minutes=20),
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def test_full_commission_debited_when_balance_is_sufficient(db, driver):
    driver.balance = 50_000
    db.commit()
    order = _order(db, driver, 10_000)

    charged, debt = debit_commission(db, driver, order, 10_000, note="test")
    db.commit()

    assert (charged, debt) == (10_000, 0)
    assert driver.balance == 40_000
    rows = db.query(BalanceTransaction).filter_by(reference_id=order.id).all()
    assert [r.source for r in rows] == [COMMISSION_SOURCE]
    assert rows[0].amount == -10_000
    assert rows[0].balance_after == 40_000


def test_partial_balance_is_floored_and_shortfall_booked_as_debt(db, driver):
    """The core regression: balance must land on 0, not -6000."""
    driver.balance = 4_000
    db.commit()
    order = _order(db, driver, 10_000)

    charged, debt = debit_commission(db, driver, order, 10_000, note="test")
    db.commit()

    assert (charged, debt) == (4_000, 6_000)
    assert driver.balance == 0, "balance must never go negative"

    rows = {r.source: r for r in db.query(BalanceTransaction).filter_by(reference_id=order.id)}
    assert set(rows) == {COMMISSION_SOURCE, COMMISSION_DEBT_SOURCE}
    assert rows[COMMISSION_SOURCE].amount == -4_000
    # The debt leg moves no money, so it records the balance it left behind.
    assert rows[COMMISSION_DEBT_SOURCE].amount == -6_000
    assert rows[COMMISSION_DEBT_SOURCE].balance_after == 0


def test_zero_balance_books_the_whole_commission_as_debt(db, driver):
    order = _order(db, driver, 10_000)

    charged, debt = debit_commission(db, driver, order, 10_000, note="test")
    db.commit()

    assert (charged, debt) == (0, 10_000)
    assert driver.balance == 0
    rows = db.query(BalanceTransaction).filter_by(reference_id=order.id).all()
    # No money moved, so there must be no `order_commission` row to overstate revenue.
    assert [r.source for r in rows] == [COMMISSION_DEBT_SOURCE]


def test_driver_is_taken_offline_when_a_commission_falls_into_debt(db, driver):
    driver.is_online = True
    driver.balance = 1_000
    db.commit()
    order = _order(db, driver, 10_000)

    debit_commission(db, driver, order, 10_000, note="test")
    db.commit()

    assert driver.is_online is False, (
        "an online driver who cannot pay commission would keep being offered rides "
        "the accept-time balance floor then rejects"
    )


def test_debit_is_a_noop_for_a_fully_discounted_ride(db, driver):
    driver.balance = 10_000
    db.commit()
    order = _order(db, driver, 10_000)

    assert debit_commission(db, driver, order, 0, note="test") == (0, 0)
    db.commit()

    assert driver.balance == 10_000
    assert db.query(BalanceTransaction).count() == 0


def test_debt_ledger_key_is_idempotent(db, driver):
    """A replay must hit the unique ledger key rather than double-booking the debt."""
    from sqlalchemy.exc import IntegrityError

    order = _order(db, driver, 10_000)
    debit_commission(db, driver, order, 10_000, note="test")
    db.commit()

    debit_commission(db, driver, order, 10_000, note="test")
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
