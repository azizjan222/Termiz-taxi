"""Startup and background-task failure handling.

Three failure modes that were previously silent:

1. ``/health/db`` verified a hardcoded list of 15 columns -- the THIRD hand-maintained
   schema list in the repo -- which had drifted out of step with the migration. It reported
   ``schema_ok: true`` on databases that were genuinely missing newer columns, which is
   worse than having no check at all, because its entire purpose is to confirm the
   migration ran.
2. A background scheduler that exited (not just raised inside its loop body) was never
   restarted. Commission collection would simply stop, with no alert and nothing in
   ``/health`` covering it.
3. A migration failure was logged as "non-fatal" and the process kept serving traffic on a
   schema it could not trust.
"""
import asyncio
import json

from aiohttp.test_utils import make_mocked_request

from app.api.server import health_db
from app.bot import app as bot_app
from app.models import Base


def _health_db_request():
    """`health_db` reads nothing off the request; it inspects the engine directly."""
    return make_mocked_request("GET", "/health/db")


# --------------------------------------------------------------------------- #
# 1. /health/db is derived from models.py                                      #
# --------------------------------------------------------------------------- #

async def test_health_db_reports_ok_on_a_fully_migrated_schema(db):
    """The `db` fixture builds the schema with create_all(), so nothing may be missing.

    This is the guard against false NEGATIVES: a check derived from Base.metadata must not
    invent missing columns on a database that is actually current.
    """
    response = await health_db(_health_db_request())
    payload = json.loads(response.body.decode())

    assert response.status == 200, payload
    assert payload["schema_ok"] is True
    # Only problem tables are listed, so a healthy database reports nothing.
    assert payload["tables"] == {}


async def test_health_db_detects_a_missing_table(db):
    """The guard against false POSITIVES, i.e. the drift that used to hide."""
    from app.database import engine

    Base.metadata.tables["ratings"].drop(bind=engine)
    try:
        response = await health_db(_health_db_request())
        payload = json.loads(response.body.decode())

        assert response.status == 500
        assert payload["schema_ok"] is False
        assert payload["tables"]["ratings"]["missing_table"] is True
    finally:
        Base.metadata.tables["ratings"].create(bind=engine)


async def test_health_db_covers_every_declared_table(db):
    """A new model must be verified automatically, with no second list to update."""
    from app.database import engine

    # Drop two unrelated tables: whichever models exist, the check must notice.
    for name in ("sos_alerts", "announcement_reads"):
        Base.metadata.tables[name].drop(bind=engine)
    try:
        response = await health_db(_health_db_request())
        payload = json.loads(response.body.decode())

        assert response.status == 500
        assert set(payload["tables"]) == {"sos_alerts", "announcement_reads"}
    finally:
        for name in ("sos_alerts", "announcement_reads"):
            Base.metadata.tables[name].create(bind=engine)


# --------------------------------------------------------------------------- #
# 2. Scheduler supervision                                                     #
# --------------------------------------------------------------------------- #

async def test_scheduler_that_exits_is_restarted(monkeypatch):
    monkeypatch.setattr(bot_app, "_SCHEDULER_RESTART_DELAY", 0)
    monkeypatch.setattr(bot_app, "_scheduler_restarts", {})
    bot_app._BACKGROUND_TASKS.clear()

    starts = 0

    def factory():
        nonlocal starts
        starts += 1

        async def _die_immediately():
            raise RuntimeError("scheduler crashed")

        return asyncio.create_task(_die_immediately())

    bot_app._start_supervised("unit_test", factory)
    # Let the task fail, the done-callback fire, and the 0s restart land.
    for _ in range(10):
        await asyncio.sleep(0)
        if starts > 1:
            break
        await asyncio.sleep(0.01)

    assert starts > 1, "a scheduler that dies must be restarted, not left dead"

    for task in bot_app._BACKGROUND_TASKS:
        task.cancel()
    bot_app._BACKGROUND_TASKS.clear()


async def test_scheduler_restarts_are_capped(monkeypatch):
    """An immediately-failing scheduler must not spin against the DB forever."""
    monkeypatch.setattr(bot_app, "_SCHEDULER_RESTART_DELAY", 0)
    monkeypatch.setattr(bot_app, "_SCHEDULER_MAX_RESTARTS", 2)
    monkeypatch.setattr(bot_app, "_scheduler_restarts", {})
    bot_app._BACKGROUND_TASKS.clear()

    starts = 0

    def factory():
        nonlocal starts
        starts += 1

        async def _die_immediately():
            raise RuntimeError("scheduler crashed")

        return asyncio.create_task(_die_immediately())

    bot_app._start_supervised("capped", factory)
    for _ in range(40):
        await asyncio.sleep(0.01)

    # 1 initial start + at most MAX_RESTARTS restarts.
    assert starts <= 3, f"restarts were not capped: {starts} starts"

    for task in bot_app._BACKGROUND_TASKS:
        task.cancel()
    bot_app._BACKGROUND_TASKS.clear()


async def test_cancelled_scheduler_is_not_restarted(monkeypatch):
    """Shutdown cancels these tasks; that must not trigger a restart storm."""
    monkeypatch.setattr(bot_app, "_SCHEDULER_RESTART_DELAY", 0)
    monkeypatch.setattr(bot_app, "_scheduler_restarts", {})
    bot_app._BACKGROUND_TASKS.clear()

    starts = 0

    def factory():
        nonlocal starts
        starts += 1

        async def _run_forever():
            await asyncio.sleep(3600)

        return asyncio.create_task(_run_forever())

    bot_app._start_supervised("shutdown", factory)
    assert starts == 1

    for task in list(bot_app._BACKGROUND_TASKS):
        task.cancel()
    await asyncio.gather(*bot_app._BACKGROUND_TASKS, return_exceptions=True)
    for _ in range(5):
        await asyncio.sleep(0.01)

    assert starts == 1, "a cancelled (shutdown) task must not be restarted"
    bot_app._BACKGROUND_TASKS.clear()
