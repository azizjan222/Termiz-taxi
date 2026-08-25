"""Telegram-based authentication: create session, verify via bot, issue token."""
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


def mark_verified(
    db: Session,
    token: str,
    telegram_id: int,
    phone: str,
    first_name: str = "",
    last_name: str = "",
) -> TelegramAuthSession | None:
    """Called by the bot when a user shares their contact."""
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
    db.commit()
    db.refresh(session)
    return session
