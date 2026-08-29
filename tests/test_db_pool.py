"""Tests for database engine/pool configuration.

The regression these guard: the engine was created with no pool settings at all, so
``pool_pre_ping`` was off. SQLAlchemy then handed out connections the server had already
closed (Postgres idle timeout, failover, restart), and each one surfaced as a 500 until the
pool churned itself clean.
"""
from app import config, database


def test_pre_ping_is_enabled_on_the_live_engine():
    """Dead pooled connections must be detected and replaced, not handed to a request.

    ``_pre_ping`` is private, but SQLAlchemy exposes no public accessor and asserting on
    the real engine is the only way to catch someone dropping the kwarg later.
    """
    assert database.engine.pool._pre_ping is True


def test_sqlite_gets_pre_ping_but_no_sizing_kwargs(monkeypatch):
    """SingletonThreadPool/NullPool reject pool_size & friends with a TypeError."""
    monkeypatch.setattr(database, "DATABASE_URL", "sqlite:////tmp/x.db")
    options = database._engine_options()

    assert options["pool_pre_ping"] is True
    assert options["connect_args"] == {"check_same_thread": False}
    for key in ("pool_size", "max_overflow", "pool_timeout", "pool_recycle"):
        assert key not in options


def test_networked_database_gets_full_pool_tuning(monkeypatch):
    monkeypatch.setattr(
        database, "DATABASE_URL", "postgresql://user:pass@localhost:5432/sarixgo"
    )
    options = database._engine_options()

    assert options["pool_pre_ping"] is True
    assert options["pool_size"] == config.DB_POOL_SIZE
    assert options["max_overflow"] == config.DB_MAX_OVERFLOW
    assert options["pool_timeout"] == config.DB_POOL_TIMEOUT
    assert options["pool_recycle"] == config.DB_POOL_RECYCLE
    # check_same_thread is a SQLite-only argument; psycopg2 errors on it.
    assert options["connect_args"] == {}


def test_pool_recycle_stays_under_the_provider_idle_cutoff():
    """Recycling must happen before the provider drops the connection, not after."""
    assert 0 < config.DB_POOL_RECYCLE < 1800


def test_pool_capacity_leaves_room_for_the_two_connections_a_request_uses():
    """Auth opens its own session before the handler's, so a request can cost two."""
    assert config.DB_POOL_SIZE >= 5
    assert config.DB_MAX_OVERFLOW >= config.DB_POOL_SIZE
    assert config.DB_POOL_TIMEOUT > 0


def test_pool_settings_fall_back_to_defaults_on_blank_env(monkeypatch):
    """.env.example ships these keys empty; int("") must not crash the boot."""
    monkeypatch.setenv("DB_POOL_SIZE", "")
    monkeypatch.setenv("DB_POOL_RECYCLE", "not-a-number")

    assert config._get_int("DB_POOL_SIZE", 10) == 10
    assert config._get_int("DB_POOL_RECYCLE", 1500) == 1500
