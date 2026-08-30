"""Linking an invited passenger to their referrer.

Kept out of the API handler because there are now TWO ways a referral gets registered and
they must apply the SAME guards:

* the passenger types a code in the app -> ``POST /api/referral/apply``
* the passenger opens ``t.me/<bot>?start=ref_CODE`` and later signs in -> the bot records a
  :class:`~app.models.PendingReferral`, which ``app/api/auth.py`` consumes at signup

The guards are the fraud model, so duplicating them is how one path ends up looser than the
other. Everything here is linking ONLY -- no bonus is ever granted at link time. Both the
referrer's reward and the invited passenger's bonus are paid only after the invited passenger
COMPLETES a ride (``app.services.rewards.apply_ride_rewards``), which is what closes the
"create fake accounts, enter codes, collect bonuses" hole.
"""
import logging

from app.models import PendingReferral, User

logger = logging.getLogger("sarixgo.referral")

#: Failure reasons, returned instead of raising so callers can localise/branch. The API maps
#: these to HTTP statuses; the auth path just logs and moves on (a bad pending code must never
#: block a signup).
ALREADY_REFERRED = "already_referred"
OWN_CODE = "own_code"
TOO_LATE = "too_late"
NOT_FOUND = "not_found"


def normalize_code(raw: str | None) -> str:
    """Codes are generated uppercase; accept whatever case the user typed or shared."""
    return (raw or "").strip().upper()


def link_referral(session, user: User, raw_code: str) -> tuple[bool, str | None, User | None]:
    """Record ``user`` as having been invited with ``raw_code``.

    Returns ``(ok, reason, referrer)``. Does NOT commit -- the caller owns the transaction,
    because both call sites have other writes to land in the same one.
    """
    code = normalize_code(raw_code)
    if not code:
        return False, NOT_FOUND, None
    if user.referred_by_user_id:
        return False, ALREADY_REFERRED, None
    if normalize_code(user.referral_code) == code:
        return False, OWN_CODE, None
    # A referral code links a genuinely NEW passenger. Once they have completed a ride the
    # "first ride" reward moment has passed, so accepting the code here would either pay
    # nothing (confusing) or have to pay retroactively (farmable).
    if (user.loyalty_lifetime_rides or 0) > 0:
        return False, TOO_LATE, None

    referrer = session.query(User).filter_by(referral_code=code).first()
    if not referrer:
        return False, NOT_FOUND, None
    if referrer.id == user.id:
        # Defensive: `referral_code` is unique, so this needs a corrupted row to happen. Still
        # worth refusing explicitly -- self-referral would pay a bonus for inviting nobody.
        return False, OWN_CODE, None

    user.referred_by_user_id = referrer.id
    logger.info("Referral linked: user=%s referrer=%s code=%s", user.id, referrer.id, code)
    return True, None, referrer


def remember_pending(session, telegram_id: int, raw_code: str) -> None:
    """Store a code from a bot deep link until the invitee actually signs up.

    The bot cannot link anything yet: ``User`` rows are created by the app's auth flow, and
    somebody arriving from an invite link usually has no account at all. One row per
    ``telegram_id``, overwritten on each new link, so the most recent invite wins rather than
    the first -- consistent with how the app behaves if you type a second code.
    """
    code = normalize_code(raw_code)
    if not telegram_id or not code:
        return
    row = session.query(PendingReferral).filter_by(telegram_id=telegram_id).first()
    if row:
        row.referral_code = code
        return
    session.add(PendingReferral(telegram_id=telegram_id, referral_code=code))
    # Flushed, not just added. `SessionLocal` is configured with `autoflush=False`
    # (app/database.py), so without this an INSERT stays invisible to the SELECT above — two
    # calls in one session both take the `else` branch and the second one violates the unique
    # constraint on `telegram_id`. Flushing is not committing: the caller still owns the
    # transaction.
    session.flush()


def consume_pending(session, user: User) -> User | None:
    """Apply and clear any pending referral for this user's Telegram account.

    Called at signup. Returns the referrer when a link was made, else None. Deliberately
    forgiving: an unusable pending code is dropped and the signup proceeds. Being unable to
    credit a referral is a minor loss; failing a signup over it is not.
    """
    telegram_id = getattr(user, "telegram_id", None)
    if not telegram_id:
        return None
    row = session.query(PendingReferral).filter_by(telegram_id=telegram_id).first()
    if not row:
        return None

    ok, reason, referrer = link_referral(session, user, row.referral_code)
    # Cleared either way: a code that cannot be applied now (own code, already referred, a
    # referrer whose account is gone) will not become applicable later, and leaving the row
    # behind would retry it on every subsequent signup with the same Telegram id.
    code = row.referral_code
    session.delete(row)
    # Flushed for the same reason as in `remember_pending`: with `autoflush=False` the DELETE
    # would otherwise not be visible to later queries in this session, and a caller that only
    # commits on success would leave the row in place — which is precisely the "retry forever"
    # behaviour this delete exists to prevent.
    session.flush()
    if not ok:
        logger.info(
            "Pending referral dropped: telegram_id=%s code=%s reason=%s",
            telegram_id, code, reason,
        )
        return None
    return referrer
