"""Tests for the two independent maintenance switches.

The feature exists because a single flag was misleading: the admin panel showed one
"Texnik xizmat rejimi" checkbox that paused the Telegram bot, while ``app/api/app_config.py``
returned a HARDCODED ``maintenance_mode: False`` — so both mobile apps kept taking orders and
nothing in the panel said so. An operator pausing the service for a deployment had every
reason to believe everything had stopped.

There are now two keys, and the property that matters most is that they are INDEPENDENT:
pausing one must never pause the other, and pausing both is how you pause everything.
"""
import pytest
from aiohttp.test_utils import make_mocked_request

from app.api.app_config import get_app_config
from app.models import Setting
from app.services.dynamic_settings import (
    get_bool_setting,
    is_apps_maintenance,
    is_bot_maintenance,
)

BOT_KEY = "maintenance_mode"
APPS_KEY = "maintenance_mode_apps"


def _set(db, key, value):
    """Upsert a Setting the way the admin API does."""
    row = db.query(Setting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


# --------------------------------------------------------------------------- reading

def test_missing_row_uses_default(db):
    assert get_bool_setting(db, APPS_KEY, False) is False
    assert get_bool_setting(db, APPS_KEY, True) is True


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on", " True "])
def test_truthy_spellings_all_enable(db, raw):
    # Three different writers touch these keys: the bot writes "true"/"false", the web panel
    # writes "1"/"0", and a human editing the table by hand might type "yes". A reader that
    # only understood one of those would silently leave the service running.
    _set(db, APPS_KEY, raw)
    assert get_bool_setting(db, APPS_KEY, False) is True


@pytest.mark.parametrize("raw", ["0", "false", "no", "off"])
def test_falsy_spellings_all_disable(db, raw):
    _set(db, APPS_KEY, raw)
    assert get_bool_setting(db, APPS_KEY, False) is False


def test_blank_value_uses_default(db):
    _set(db, APPS_KEY, "   ")
    assert get_bool_setting(db, APPS_KEY, True) is True


def test_unrecognised_value_reads_as_off(db):
    # Deliberately biased towards "service stays up": a typo in the table should not be able
    # to take the apps dark, which is the more surprising and more damaging direction.
    _set(db, APPS_KEY, "banana")
    assert get_bool_setting(db, APPS_KEY, False) is False


# ------------------------------------------------------------- the two flags are separate

def test_both_default_to_off(db):
    assert is_bot_maintenance(db) is False
    assert is_apps_maintenance(db) is False


def test_pausing_the_bot_leaves_the_apps_running(db):
    _set(db, BOT_KEY, "1")
    assert is_bot_maintenance(db) is True
    # The whole point of the split. Before it, this was the ONLY switch, and it did nothing
    # to the apps while looking like it stopped everything.
    assert is_apps_maintenance(db) is False


def test_pausing_the_apps_leaves_the_bot_running(db):
    _set(db, APPS_KEY, "1")
    assert is_apps_maintenance(db) is True
    assert is_bot_maintenance(db) is False


def test_both_can_be_paused_together(db):
    _set(db, BOT_KEY, "1")
    _set(db, APPS_KEY, "1")
    assert is_bot_maintenance(db) is True
    assert is_apps_maintenance(db) is True


def test_the_bot_reader_agrees_with_what_the_panel_writes(db):
    """The bot has its own reader for its key; the two must not disagree.

    ``app/bot/store.py`` predates ``dynamic_settings`` and owns the write path for the bot's
    own admin command, so there are two readers of one key. The panel writes "1"/"0" while
    ``store.set_maintenance`` writes "true"/"false" — if either reader understood only its own
    spelling, toggling from one surface would appear to do nothing from the other.
    """
    from app.bot.store import store

    _set(db, BOT_KEY, "1")  # as written by the web panel
    assert store.is_maintenance() is True
    assert is_bot_maintenance(db) is True

    _set(db, BOT_KEY, "false")  # as written by the bot command
    assert store.is_maintenance() is False
    assert is_bot_maintenance(db) is False


# ------------------------------------------------------------------ the apps see the flag

async def _config(app_type="passenger"):
    request = make_mocked_request("GET", f"/api/config?app={app_type}")
    response = await get_app_config(request)
    import json

    return json.loads(response.body.decode())


async def test_config_endpoint_reports_no_maintenance_by_default(db):
    payload = await _config()
    assert payload["maintenance_mode"] is False


@pytest.mark.parametrize("app_type", ["passenger", "driver"])
async def test_config_endpoint_reports_apps_maintenance(db, app_type):
    """Regression: this field was the literal ``False``.

    Both apps read the same flag from the same endpoint, so both are checked — the driver app
    had no config call at all before this change, which is how the discrepancy stayed hidden.
    """
    _set(db, APPS_KEY, "1")
    payload = await _config(app_type)
    assert payload["maintenance_mode"] is True


async def test_config_endpoint_ignores_the_bot_flag(db):
    # A paused bot must not blank out the apps. This is the assertion that would have caught
    # the original bug had it been written the other way round.
    _set(db, BOT_KEY, "1")
    payload = await _config()
    assert payload["maintenance_mode"] is False



# ------------------------------------------------------- the panel can set them separately

async def _admin_client():
    """Logged-in admin client. Mirrors tests/test_admin_security.py."""
    from aiohttp import CookieJar
    from aiohttp.test_utils import TestClient, TestServer

    from app import config as app_config
    from app.admin.middleware import reset_login_limiter
    from app.api.server import create_app

    reset_login_limiter()
    client = TestClient(TestServer(create_app()), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()

    def csrf():
        cookies = client.session.cookie_jar.filter_cookies(client.make_url("/admin/"))
        return cookies["admin_csrf"].value

    assert (await client.get("/admin/login")).status == 200
    login = await client.post(
        "/admin/login",
        data={
            "username": app_config.ADMIN_USERNAME,
            "password": app_config.ADMIN_PASSWORD,
            "csrf_token": csrf(),
        },
        allow_redirects=False,
    )
    assert login.status == 302
    return client, csrf


async def test_panel_saves_and_reports_each_switch_independently(db, monkeypatch):
    from app import config as app_config

    monkeypatch.setattr(app_config, "ADMIN_COOKIE_SECURE", False)
    client, csrf = await _admin_client()
    try:
        # Pause the apps only.
        saved = await client.request(
            "PUT",
            "/admin/api/settings",
            json={"maintenance_mode": False, "maintenance_mode_apps": True},
            headers={"X-CSRF-Token": csrf()},
        )
        assert saved.status == 200

        shown = await (await client.get("/admin/api/settings")).json()
        assert shown["maintenance_mode"] is False
        assert shown["maintenance_mode_apps"] is True
        # And the apps' own endpoint agrees — the panel and /api/config must never disagree
        # about this, which is exactly what the hardcoded `False` used to guarantee.
        assert (await _config())["maintenance_mode"] is True

        # Now pause everything.
        saved = await client.request(
            "PUT",
            "/admin/api/settings",
            json={"maintenance_mode": True, "maintenance_mode_apps": True},
            headers={"X-CSRF-Token": csrf()},
        )
        assert saved.status == 200
        shown = await (await client.get("/admin/api/settings")).json()
        assert shown["maintenance_mode"] is True
        assert shown["maintenance_mode_apps"] is True

        # And release both.
        saved = await client.request(
            "PUT",
            "/admin/api/settings",
            json={"maintenance_mode": False, "maintenance_mode_apps": False},
            headers={"X-CSRF-Token": csrf()},
        )
        assert saved.status == 200
        assert (await _config())["maintenance_mode"] is False
    finally:
        await client.close()


async def test_panel_still_rejects_unknown_settings(db, monkeypatch):
    """The unknown-key guard must survive the switch to a keyed loop.

    It exists because a client sending an unrecognised key used to get "Sozlamalar saqlandi"
    and no change at all; widening `known` for the second flag is an easy way to break it.
    """
    from app import config as app_config

    monkeypatch.setattr(app_config, "ADMIN_COOKIE_SECURE", False)
    client, csrf = await _admin_client()
    try:
        rejected = await client.request(
            "PUT",
            "/admin/api/settings",
            json={"maintenance_mode_app": True},  # note: singular, a plausible typo
            headers={"X-CSRF-Token": csrf()},
        )
        assert rejected.status == 400
        assert "maintenance_mode_app" in (await rejected.json())["error"]
    finally:
        await client.close()
