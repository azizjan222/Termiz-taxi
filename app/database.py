"""Database session management."""
import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import DATABASE_URL
from app.models import Base

# Ensure data directory exists for sqlite
if DATABASE_URL.startswith("sqlite:///"):
    db_path = DATABASE_URL.replace("sqlite:///", "")
    db_dir = Path(db_path).parent
    db_dir.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db():
    """Create all tables."""
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """Get a new database session. Caller must close it."""
    return SessionLocal()


class DbContext:
    """Context manager for db session."""
    def __enter__(self) -> Session:
        self.session = SessionLocal()
        return self.session

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.session.rollback()
        else:
            try:
                self.session.commit()
            except Exception:
                self.session.rollback()
                raise
        self.session.close()
