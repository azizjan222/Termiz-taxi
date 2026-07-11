"""Tests for live, admin-editable settings (Setting table with config fallback)."""
from app import config
from app.models import Setting
from app.services.dynamic_settings import (
    get_free_trial_days,
    get_free_trial_limit,
    get_int_setting,
    get_min_driver_balance,
)


def _set(db, key, value):
    db.add(Setting(key=key, value=value))
    db.commit()


def test_returns_default_when_missing(db):
    assert get_int_setting(db, "min_balance", 20000) == 20000


def test_reads_stored_value(db):
    _set(db, "min_balance", "50000")
    assert get_int_setting(db, "min_balance", 20000) == 50000


def test_blank_value_falls_back(db):
    _set(db, "min_balance", "   ")
    assert get_int_setting(db, "min_balance", 20000) == 20000


def test_non_numeric_falls_back(db):
    _set(db, "min_balance", "abc")
    assert get_int_setting(db, "min_balance", 20000) == 20000


def test_float_like_value_is_truncated(db):
    _set(db, "free_trial_days", "30.0")
    assert get_int_setting(db, "free_trial_days", 15) == 30


def test_below_low_bound_falls_back(db):
    _set(db, "min_balance", "-100")
    assert get_int_setting(db, "min_balance", 20000, lo=0) == 20000


def test_above_high_bound_falls_back(db):
    _set(db, "commission_percent", "500")
    assert get_int_setting(db, "commission_percent", 10, lo=0, hi=100) == 10


def test_within_bounds_is_accepted(db):
    _set(db, "commission_percent", "25")
    assert get_int_setting(db, "commission_percent", 10, lo=0, hi=100) == 25


# --- wrappers fall back to config when nothing is stored ---

def test_min_driver_balance_wrapper_uses_config_default(db):
    assert get_min_driver_balance(db) == config.MIN_DRIVER_BALANCE


def test_min_driver_balance_wrapper_reads_setting(db):
    _set(db, "min_balance", "35000")
    assert get_min_driver_balance(db) == 35000


def test_free_trial_days_wrapper_default(db):
    assert get_free_trial_days(db) == config.FREE_TRIAL_DAYS


def test_free_trial_limit_wrapper_default(db):
    assert get_free_trial_limit(db) == config.FREE_TRIAL_DRIVER_LIMIT
