"""Live, admin-editable settings.

The web admin Settings page (and the bot) write these values into the ``Setting`` table.
The rest of the backend must READ them from here — with the ``config.*`` environment
values as a fallback — so a change made in the admin panel takes effect immediately.

Previously only ``commission_percent`` was wired up this way. ``min_balance``,
``free_trial_days`` and ``free_trial_limit`` were saved by the Settings page but IGNORED
(the code kept using the env constants), so editing them in the panel did nothing.
"""
from app import config
from app.database import get_session
from app.models import Setting


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


# ============= Loyalty & referral (admin-editable) =============

def get_loyalty_points_per_ride(session) -> int:
    """Points earned per completed ride (admin key ``loyalty_points_per_ride``)."""
    return get_int_setting(session, "loyalty_points_per_ride", config.LOYALTY_POINTS_PER_RIDE, lo=0)


def get_loyalty_threshold(session) -> int:
    """Points needed before they convert to bonus (admin key ``loyalty_reward_threshold``)."""
    return get_int_setting(session, "loyalty_reward_threshold", config.LOYALTY_REWARD_THRESHOLD, lo=1)


def get_loyalty_reward(session) -> int:
    """Bonus granted each time the threshold is reached (admin key ``loyalty_reward_bonus``)."""
    return get_int_setting(session, "loyalty_reward_bonus", config.LOYALTY_REWARD_BONUS, lo=0)


def get_referral_referrer_bonus(session) -> int:
    """Bonus paid to the referrer (admin key ``referral_referrer_bonus``)."""
    return get_int_setting(session, "referral_referrer_bonus", config.REFERRAL_REFERRER_BONUS, lo=0)


def get_referral_new_user_bonus(session) -> int:
    """Bonus paid to an invited passenger per qualifying ride (``referral_new_user_bonus``)."""
    return get_int_setting(session, "referral_new_user_bonus", config.REFERRAL_NEW_USER_BONUS, lo=0)


def get_referral_new_user_max_rides(session) -> int:
    """How many of the invited passenger's first rides earn the new-user bonus
    (admin key ``referral_new_user_max_rides``)."""
    return get_int_setting(session, "referral_new_user_max_rides", config.REFERRAL_NEW_USER_MAX_RIDES, lo=0)


def get_bonus_max_per_ride(session) -> int:
    """Max bonus applied to a single ride (admin key ``bonus_max_per_ride``)."""
    return get_int_setting(session, "bonus_max_per_ride", config.BONUS_MAX_PER_RIDE, lo=0)


def get_referral_max_rewarded(session) -> int:
    """Max referrals one user can be rewarded for; 0 = unlimited
    (admin key ``referral_max_rewarded``). Fraud guard against mass fake invites."""
    return get_int_setting(session, "referral_max_rewarded", config.REFERRAL_MAX_REWARDED, lo=0)
