"""Live, admin-editable settings.

The web admin Settings page (and the bot) write these values into the ``Setting`` table.
The rest of the backend must READ them from here — with the ``config.*`` environment
values as a fallback — so a change made in the admin panel takes effect immediately.

Previously only ``commission_percent`` was wired up this way. ``min_balance``,
``free_trial_days`` and ``free_trial_limit`` were saved by the Settings page but IGNORED
(the code kept using the env constants), so editing them in the panel did nothing.
"""
from app.database import get_session
from app.models import Setting
from app import config


def get_int_setting(session, key: str, default: int, *, lo=None, hi=None) -> int:
    """Read an integer Setting by key, falling back to ``default``.

    Ignores missing/blank/out-of-range/non-numeric values (returns ``default`` for
    those) so a bad row in the table can never break the caller.
    """
    try:
        row = session.query(Setting).filter_by(key=key).first()
        if row and row.value is not None and str(row.value).strip() != "":
            val = int(float(str(row.value).strip()))
            if (lo is None or val >= lo) and (hi is None or val <= hi):
                return val
    except Exception:
        pass
    return default


def get_min_driver_balance(session=None) -> int:
    """Minimum balance a driver needs to accept orders (admin key ``min_balance``)."""
    if session is not None:
        return get_int_setting(session, "min_balance", config.MIN_DRIVER_BALANCE, lo=0)
    s = get_session()
    try:
        return get_int_setting(s, "min_balance", config.MIN_DRIVER_BALANCE, lo=0)
    finally:
        s.close()


def get_free_trial_days(session) -> int:
    """Free-trial length in days (admin key ``free_trial_days``)."""
    return get_int_setting(session, "free_trial_days", config.FREE_TRIAL_DAYS, lo=0)


def get_free_trial_limit(session) -> int:
    """How many drivers get the free trial (admin key ``free_trial_limit``)."""
    return get_int_setting(session, "free_trial_limit", config.FREE_TRIAL_DRIVER_LIMIT, lo=0)
