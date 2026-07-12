"""Shared pytest fixtures for the backend test suite.

A throwaway environment is configured BEFORE any app module is imported, because
`app.config` / `app.database` resolve the DB engine and secrets at import time. Each
test gets a fresh schema on a temp-file SQLite DB, so tests are fully isolated.
"""
import os
import tempfile

# --- Environment must be set before importing any `app.*` module ---
os.environ.setdefault("BOT_TOKEN", "test-token")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("OTP_PROVIDER", "mock")

_TMP_DIR = tempfile.mkdtemp(prefix="sarixgo-tests-")
# Absolute sqlite path (4 slashes) so config honours it as-is.
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DIR}/test.db"
# Keep auto-generated secrets inside the temp dir (not the repo's ./data).
os.environ["DATA_DIR"] = _TMP_DIR

import pytest  # noqa: E402

from app.database import engine, get_session  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture
def db():
    """Yield a DB session with a fresh schema (dropped & recreated per test)."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def make_route(db):
    """Factory: insert a Route and return it."""
    from app.models import Route

    def _make(from_city="Termiz", to_city="Sariosiyo", price_per_person=30000, **kwargs):
        route = Route(
            from_city=from_city,
            to_city=to_city,
            price_per_person=price_per_person,
            **kwargs,
        )
        db.add(route)
        db.commit()
        db.refresh(route)
        return route

    return _make
