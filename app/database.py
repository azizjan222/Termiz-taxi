"""Database session management."""
import os
import logging
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import DATABASE_URL, PERSISTENT_DATA_DIR
from app.models import Base

logger = logging.getLogger("sarixgo.db")

# Ensure data directory exists for sqlite
if DATABASE_URL.startswith("sqlite"):
    db_path = DATABASE_URL.split("sqlite:///")[-1]
    # Absolute sqlite URLs look like sqlite:////data/sarixgo.db -> path "/data/sarixgo.db"
    db_dir = Path(db_path).parent
    try:
        db_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # pragma: no cover
        logger.warning("Could not create DB directory %s: %s", db_dir, e)

    persistent = os.path.isdir(PERSISTENT_DATA_DIR) and str(db_dir).startswith(
        PERSISTENT_DATA_DIR.rstrip("/")
    )
    if persistent:
        logger.info("Using SQLite at %s (persistent volume) ✅", db_path)
    else:
        logger.warning(
            "Using SQLite at %s which is NOT on a persistent volume (%s). "
            "On Railway/containers this file is wiped on every restart, which logs "
            "users out and breaks orders. Mount a volume at %s or set DATABASE_URL "
            "to a Postgres connection string.",
            db_path,
            PERSISTENT_DATA_DIR,
            PERSISTENT_DATA_DIR,
        )
else:
    logger.info("Using external database (%s) ✅", DATABASE_URL.split("://")[0])

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

# expire_on_commit=False is REQUIRED here. The codebase's pattern is: load an ORM
# object, commit, close the session, then return the object and read its attributes in
# the request handler / serializer. With the SQLAlchemy default (expire_on_commit=True),
# commit() expires every attribute, so the first attribute access after the session is
# closed raises DetachedInstanceError -> 500 on EVERY authenticated request
# (get_current_user / require_driver). That made orders, online toggle, profile, payments
# etc. all fail in both apps. Disabling expiry keeps the loaded attributes usable after
# commit/close.
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
)


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
