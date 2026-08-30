"""Tests for referral LINKING — the step that was missing end to end.

The reward maths already had coverage (``tests/test_rewards.py``). What had none was the part
that decides *whether a passenger is linked to a referrer at all*, and that path was broken in
three places at once: the app had no way to enter a code, the bot ignored ``ref_`` links
entirely, and nothing consumed an invite at signup. So a fully working reward engine sat behind
a door nobody could open.

Guards are the fraud model here, so they are asserted per-path: whatever the entry point, a
code must not be applicable twice, to yourself, or after your first ride.
"""
import pytest

from app.models import PendingReferral, User
from app.services import referral as svc


def _user(db, phone, code=None, rides=0, telegram_id=None, referred_by=None):
    u = User(
        phone=phone,
        referral_code=code,
        loyalty_lifetime_rides=rides,
        telegram_id=telegram_id,
        referred_by_user_id=referred_by,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# --------------------------------------------------------------------------- link_referral

def test_links_invitee_to_referrer(db):
    referrer = _user(db, "+998900000001", code="ABC123")
    invitee = _user(db, "+998900000002")

    ok, reason, linked = svc.link_referral(db, invitee, "ABC123")
    db.commit()

    assert ok is True
    assert reason is None
    assert linked.id == referrer.id
    assert invitee.referred_by_user_id == referrer.id


def test_code_is_case_and_whitespace_insensitive(db):
    _user(db, "+998900000001", code="ABC123")
    invitee = _user(db, "+998900000002")

    # Codes travel through Share sheets, chat apps and manual typing; requiring exact case
    # would reject codes that are, to the user, obviously correct.
    ok, _, _ = svc.link_referral(db, invitee, "  abc123 ")
    assert ok is True


def test_grants_no_bonus_at_link_time(db):
    """Linking must not pay anything — that is the whole anti-farming design."""
    referrer = _user(db, "+998900000001", code="ABC123")
    invitee = _user(db, "+998900000002")

    svc.link_referral(db, invitee, "ABC123")
    db.commit()

    assert (invitee.bonus_balance or 0) == 0
    assert (referrer.bonus_balance or 0) == 0
    assert (referrer.referral_count or 0) == 0


def test_rejects_a_second_code(db):
    first = _user(db, "+998900000001", code="ABC123")
    _user(db, "+998900000009", code="ZZZ999")
    invitee = _user(db, "+998900000002")

    assert svc.link_referral(db, invitee, "ABC123")[0] is True
    db.commit()

    ok, reason, _ = svc.link_referral(db, invitee, "ZZZ999")
    assert ok is False
    assert reason == svc.ALREADY_REFERRED
    assert invitee.referred_by_user_id == first.id  # unchanged


def test_rejects_own_code(db):
    user = _user(db, "+998900000001", code="ABC123")
    ok, reason, _ = svc.link_referral(db, user, "ABC123")
    assert ok is False
    assert reason == svc.OWN_CODE


def test_rejects_after_a_completed_ride(db):
    _user(db, "+998900000001", code="ABC123")
    veteran = _user(db, "+998900000002", rides=1)

    # The reward fires on the invitee's FIRST completed ride, so a code accepted afterwards
    # could only pay retroactively — which is exactly how it would be farmed.
    ok, reason, _ = svc.link_referral(db, veteran, "ABC123")
    assert ok is False
    assert reason == svc.TOO_LATE


def test_rejects_unknown_code(db):
    invitee = _user(db, "+998900000002")
    ok, reason, _ = svc.link_referral(db, invitee, "NOPE00")
    assert ok is False
    assert reason == svc.NOT_FOUND


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_rejects_empty_code(db, raw):
    invitee = _user(db, "+998900000002")
    ok, reason, _ = svc.link_referral(db, invitee, raw)
    assert ok is False
    assert reason == svc.NOT_FOUND


# ----------------------------------------------------------------- pending (bot deep link)

def test_remember_pending_stores_one_row_per_telegram_account(db):
    svc.remember_pending(db, 555, "ABC123")
    svc.remember_pending(db, 555, "ZZZ999")
    db.commit()

    rows = db.query(PendingReferral).filter_by(telegram_id=555).all()
    # Overwritten, not duplicated: the most recent invite wins, matching what typing a second
    # code in the app would do.
    assert len(rows) == 1
    assert rows[0].referral_code == "ZZZ999"


def test_consume_pending_links_at_signup(db):
    referrer = _user(db, "+998900000001", code="ABC123")
    svc.remember_pending(db, 555, "ABC123")
    db.commit()

    # The invitee signs up later, from the same Telegram account that opened the link.
    invitee = _user(db, "+998900000002", telegram_id=555)
    linked = svc.consume_pending(db, invitee)
    db.commit()

    assert linked is not None and linked.id == referrer.id
    assert invitee.referred_by_user_id == referrer.id
    # Consumed, so a later signup on the same account cannot replay it.
    assert db.query(PendingReferral).filter_by(telegram_id=555).count() == 0


def test_consume_pending_is_a_noop_without_a_pending_row(db):
    invitee = _user(db, "+998900000002", telegram_id=555)
    assert svc.consume_pending(db, invitee) is None
    assert invitee.referred_by_user_id is None


def test_consume_pending_ignores_users_without_telegram(db):
    _user(db, "+998900000001", code="ABC123")
    svc.remember_pending(db, 555, "ABC123")
    db.commit()

    # Phone-OTP signup: no Telegram id, so there is nothing to match the pending row against.
    invitee = _user(db, "+998900000002")
    assert svc.consume_pending(db, invitee) is None
    assert db.query(PendingReferral).filter_by(telegram_id=555).count() == 1


def test_consume_pending_drops_an_unusable_code(db):
    """A pending code that cannot apply must be cleared, not retried forever."""
    svc.remember_pending(db, 555, "GONE00")  # no such referrer
    db.commit()

    invitee = _user(db, "+998900000002", telegram_id=555)
    assert svc.consume_pending(db, invitee) is None
    assert invitee.referred_by_user_id is None
    # Cleared: it will never become valid, and leaving it would re-run on every signup with
    # this Telegram id.
    assert db.query(PendingReferral).filter_by(telegram_id=555).count() == 0


def test_consume_pending_respects_the_already_referred_guard(db):
    first = _user(db, "+998900000001", code="ABC123")
    _user(db, "+998900000009", code="ZZZ999")
    svc.remember_pending(db, 555, "ZZZ999")
    db.commit()

    invitee = _user(db, "+998900000002", telegram_id=555, referred_by=first.id)
    assert svc.consume_pending(db, invitee) is None
    assert invitee.referred_by_user_id == first.id
    assert db.query(PendingReferral).filter_by(telegram_id=555).count() == 0


def test_consume_pending_respects_the_first_ride_guard(db):
    _user(db, "+998900000001", code="ABC123")
    svc.remember_pending(db, 555, "ABC123")
    db.commit()

    veteran = _user(db, "+998900000002", telegram_id=555, rides=3)
    assert svc.consume_pending(db, veteran) is None
    assert veteran.referred_by_user_id is None
