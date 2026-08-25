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


def claim_verified_session(
    db: Session, token: str, role: str
) -> tuple[TelegramAuthSession | None, str]:
    """Atomically consume one verified session and return it with a status string.

    A verified row used to stay ``status="verified"`` forever, and the redeem endpoints
    re-checked neither ``expires_at`` nor ``role``. That let a single deep-link token be
    replayed indefinitely for fresh 30-day JWTs, and let a passenger-role session be
    redeemed for a driver token. Consuming the row here closes both.

    Returns ``(session, status)`` where status is one of ``ok``, ``not_found``,
    ``pending``, ``expired`` or ``role_mismatch``. Only ``ok`` carries a session.
    """
    session = get_session(db, token)
    if not session:
        return None, "not_found"
    if session.status == "pending":
        return None, "pending"
    if session.status != "verified":
        # Already consumed ("used"), or explicitly expired earlier.
        return None, "expired"
    if session.expires_at and session.expires_at < datetime.utcnow():
        session.status = "expired"
        db.commit()
        return None, "expired"
    if (session.role or "passenger") != role:
        return None, "role_mismatch"

    # Single-use: only the caller that flips verified -> used may mint a token.
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

    Same single-use / expiry / role guarantees as ``claim_verified_session``, plus a
    constant-time code comparison and a wrong-attempt cap.

    Returns ``(session, status)`` where status is one of ``ok``, ``not_found``,
    ``pending``, ``expired``, ``role_mismatch``, ``bad_code`` or ``too_many_attempts``.
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
