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
