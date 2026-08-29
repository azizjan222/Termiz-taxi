"""Telegram-based authentication: create session, verify via bot, issue token."""
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import TelegramAuthSession

SESSION_TTL_MINUTES = 10


def create_session(db: Session, role: str = "passenger") -> TelegramAuthSession:
    """Create a pending Telegram auth session and return it."""
    token = secrets.token_urlsafe(24)
    session = TelegramAuthSession(
        token=token,
        role=role if role in ("passenger", "driver") else "passenger",
        status="pending",
        expires_at=datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, token: str) -> TelegramAuthSession | None:
    return (
        db.query(TelegramAuthSession)
        .filter(TelegramAuthSession.token == token)
        .first()
    )


#: Digits in the one-time login code the bot sends into the user's Telegram chat.
LOGIN_CODE_LENGTH = 6
#: Wrong-code attempts allowed before the session is burnt.
MAX_CODE_ATTEMPTS = 5


def generate_login_code() -> str:
    """Cryptographically random numeric login code."""
    return "".join(secrets.choice("0123456789") for _ in range(LOGIN_CODE_LENGTH))


def mark_verified(
    db: Session,
    token: str,
    telegram_id: int,
    phone: str,
    first_name: str = "",
    last_name: str = "",
) -> TelegramAuthSession | None:
    """Called by the bot when a user shares their contact.

    Also mints the one-time ``login_code``; the caller (the bot) reads it off the
    returned session and sends it to the user's chat.
    """
    session = get_session(db, token)
    if not session:
        return None
    if session.expires_at < datetime.utcnow():
        session.status = "expired"
        db.commit()
        return None

    session.telegram_id = telegram_id
    session.phone = phone
    session.first_name = first_name
    session.last_name = last_name
    session.status = "verified"
    session.login_code = generate_login_code()
    session.code_attempts = 0
    db.commit()
    db.refresh(session)
    return session


def claim_by_login_code(
    db: Session, token: str, code: str, role: str
) -> tuple[TelegramAuthSession | None, str]:
    """Consume one verified session by matching the code the bot sent.

    This is the ONLY way to redeem an auth session. A code-free sibling
    (``claim_verified_session``) used to back the ``/telegram/check`` poll endpoints and
    was removed: holding the session token alone was enough to mint a 30-day JWT, so a
    deep link the attacker generated and got a victim to open became an account takeover.
    Requiring the code binds redemption to whoever actually receives the bot's message.

    Guarantees, all of which earlier revisions got wrong at least once:

    - **Single-use** — a verified row used to stay ``verified`` forever, so one deep link
      could be replayed indefinitely for fresh tokens. Only the caller that atomically
      flips ``verified -> used`` gets a session back.
    - **Expiry re-checked at redeem time**, not just when the bot marks the row verified.
    - **Role-bound** — a passenger-role session must never mint a driver token.
    - **Constant-time code comparison** plus a wrong-attempt cap that burns the session.

    Returns ``(session, status)`` where status is one of ``ok``, ``not_found``,
    ``pending``, ``expired``, ``role_mismatch``, ``bad_code`` or ``too_many_attempts``.
    Only ``ok`` carries a session.
    """
    code = (code or "").strip()
    session = get_session(db, token)
    if not session:
        return None, "not_found"
    if session.status == "pending":
        return None, "pending"
    if session.status != "verified":
        return None, "expired"
    if session.expires_at and session.expires_at < datetime.utcnow():
        session.status = "expired"
        db.commit()
        return None, "expired"
    if (session.role or "passenger") != role:
        return None, "role_mismatch"
    if not session.login_code:
        # Verified by an older bot build that never minted a code.
        return None, "expired"

    if (session.code_attempts or 0) >= MAX_CODE_ATTEMPTS:
        session.status = "expired"
        db.commit()
        return None, "too_many_attempts"

    # Compare on bytes: compare_digest raises TypeError on non-ASCII str input, and the
    # code arrives straight from the request body.
    if not hmac.compare_digest(
        str(session.login_code).encode("utf-8"), code.encode("utf-8")
    ):
        session.code_attempts = (session.code_attempts or 0) + 1
        burnt = session.code_attempts >= MAX_CODE_ATTEMPTS
        if burnt:
            session.status = "expired"
        db.commit()
        return None, "too_many_attempts" if burnt else "bad_code"

    # Correct code: consume the session so it cannot be replayed.
    claimed = (
        db.query(TelegramAuthSession)
        .filter(
            TelegramAuthSession.id == session.id,
            TelegramAuthSession.status == "verified",
        )
        .update({TelegramAuthSession.status: "used"}, synchronize_session=False)
    )
    if claimed != 1:
        db.rollback()
        return None, "expired"
    db.commit()
    db.refresh(session)
    return session, "ok"
