"""Tests for order pricing and commission calculation.

These cover the money-critical logic in app.api.orders:
  - get_commission_percent(): live, admin/bot-editable commission %, with safe fallback
  - _calc_price_and_commission(): price + commission per service type
A bug here means drivers are over/under-charged, so this is the highest-value suite.
"""
from app import config
from app.api.orders import get_commission_percent, _calc_price_and_commission
from app.models import Setting


# --------------------------- get_commission_percent ---------------------------

def test_commission_defaults_to_config_when_no_setting(db):
    assert get_commission_percent(db) == config.COMMISSION_PERCENT


def test_commission_reads_setting_value(db):
    db.add(Setting(key="commission_percent", value="15"))
    db.commit()
    assert get_commission_percent(db) == 15


def test_commission_accepts_zero(db):
    db.add(Setting(key="commission_percent", value="0"))
    db.commit()
    assert get_commission_percent(db) == 0


def test_commission_invalid_value_falls_back(db):
    db.add(Setting(key="commission_percent", value="not-a-number"))
    db.commit()
    assert get_commission_percent(db) == config.COMMISSION_PERCENT


def test_commission_out_of_range_falls_back(db):
    db.add(Setting(key="commission_percent", value="150"))
    db.commit()
    assert get_commission_percent(db) == config.COMMISSION_PERCENT


def test_commission_negative_falls_back(db):
    db.add(Setting(key="commission_percent", value="-5"))
    db.commit()
    assert get_commission_percent(db) == config.COMMISSION_PERCENT


# ------------------------ _calc_price_and_commission --------------------------

def test_taxi_price_single_person(db, make_route):
    make_route(price_per_person=30000)
    price, commission, err = _calc_price_and_commission(
        db, "Termiz", "Sariosiyo", "taxi", 1
    )
    assert err is None
    assert price == 30000
    assert commission == round(30000 * config.COMMISSION_PERCENT / 100)


def test_taxi_price_scales_with_persons(db, make_route):
    make_route(price_per_person=30000)
    price, _, err = _calc_price_and_commission(db, "Termiz", "Sariosiyo", "taxi", 3)
    assert err is None
    assert price == 90000


def test_taxi_persons_clamped_to_ten(db, make_route):
    make_route(price_per_person=10000)
    price, _, _ = _calc_price_and_commission(db, "Termiz", "Sariosiyo", "taxi", 999)
    assert price == 10000 * 10  # capped at 10 passengers


def test_taxi_persons_floor_of_one(db, make_route):
    make_route(price_per_person=10000)
    price, _, _ = _calc_price_and_commission(db, "Termiz", "Sariosiyo", "taxi", 0)
    assert price == 10000  # min 1 passenger


def test_full_car_priced_at_four_seats(db, make_route):
    make_route(price_per_person=30000)
    price, commission, err = _calc_price_and_commission(
        db, "Termiz", "Sariosiyo", "full_car", 1
    )
    assert err is None
    assert price == 30000 * 4
    assert commission == round(price * config.COMMISSION_PERCENT / 100)


def test_parcel_price_is_negotiable_with_flat_commission(db, make_route):
    make_route(price_per_person=30000)
    price, commission, err = _calc_price_and_commission(
        db, "Termiz", "Sariosiyo", "parcel", 1
    )
    assert err is None
    assert price == 0  # "Kelishiladi" (agreed between passenger & driver)
    assert commission == config.COMMISSION_PARCEL


def test_unknown_route_returns_error(db):
    price, commission, err = _calc_price_and_commission(
        db, "Nowhere", "Nowhere2", "taxi", 1
    )
    assert err is not None
    assert price == 0
    assert commission == 0


def test_commission_uses_live_setting_value(db, make_route):
    make_route(price_per_person=30000)
    db.add(Setting(key="commission_percent", value="20"))
    db.commit()
    price, commission, err = _calc_price_and_commission(
        db, "Termiz", "Sariosiyo", "taxi", 1
    )
    assert price == 30000
    assert commission == 6000  # 20% of 30000
