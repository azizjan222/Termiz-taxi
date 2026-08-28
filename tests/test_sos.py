"""SOS endpoint tests.

The panic button had no test at all, and it was broken in the one case that matters most:
a passenger triggering SOS *during a ride* (i.e. with an `order_id`) hit a filter on
`Order.user_id` — a column that does not exist — which raised AttributeError, surfaced as a
500, and meant the admin was never messaged while an orphan alert row stayed committed.

These tests pin the ownership rules and the "always deliver the alert" guarantee.
"""
import pytest
from aiohttp import web

from app.api.sos import trigger_sos
from app.models import Driver, Order, SosAlert, User


class _FakeBot:
    """Records what would have been sent to the admin chat."""

    def __init__(self):
        self.messages = []

    async def send_message(self, chat_id=None, text=None, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text})


def _user(db, phone="+998901110001"):
    row = User(phone=phone, first_name="Ali")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _driver(db, telegram_id=9001):
    row = Driver(telegram_id=telegram_id, phone="+998902220002", first_name="Vali")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _order(db, *, passenger=None, driver=None, from_city="Termiz", to_city="Denov"):
    row = Order(
        passenger_id=passenger.id if passenger else None,
        driver_id=driver.id if driver else None,
        from_city=from_city,
        to_city=to_city,
        person_count=1,
        price=90000,
        commission=9000,
        status="in_progress",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _request(app, body, *, user=None, driver=None):
    """Minimal stand-in for an aiohttp request carrying an authenticated identity."""

    class _Req:
        def __init__(self):
            self.app = app
            self._body = body
            # `get_current_user` / `_get_driver_from_request` read these keys.
            self._store = {"user": user, "driver": driver}

        async def json(self):
            return self._body

        def get(self, key, default=None):
            return self._store.get(key, default)

        def __getitem__(self, key):
            return self._store[key]

        def __contains__(self, key):
            return key in self._store and self._store[key] is not None

    return _Req()


@pytest.fixture
def sos_app(monkeypatch):
    """An app carrying a fake bot, with a configured admin id."""
    from app import config

    monkeypatch.setattr(config, "ADMIN_ID", 12345)
    app = web.Application()
    bot = _FakeBot()
    app["bot"] = bot
    return app, bot


@pytest.fixture(autouse=True)
def _patch_identity(monkeypatch):
    """Resolve the caller from the request stub instead of a real JWT."""
    import app.api.sos as sos_module

    monkeypatch.setattr(sos_module, "get_current_user", lambda r: r.get("user"))
    monkeypatch.setattr(sos_module, "_get_driver_from_request", lambda r: r.get("driver"))


async def test_passenger_sos_with_own_order_succeeds_and_alerts_admin(db, sos_app):
    """The regression this file exists for: it used to raise AttributeError -> 500."""
    app, bot = sos_app
    user = _user(db)
    order = _order(db, passenger=user)

    resp = await trigger_sos(_request(app, {"order_id": order.id}, user=user))

    assert resp.status == 200
    # The alert really went out, and it names the route so the admin can act on it.
    assert len(bot.messages) == 1
    assert "SOS" in bot.messages[0]["text"]
    assert f"#{order.id}" in bot.messages[0]["text"]

    db.expire_all()
    alert = db.query(SosAlert).one()
    assert alert.order_id == order.id
    assert alert.user_id == user.id
    assert alert.reporter_type == "passenger"


async def test_passenger_cannot_attach_someone_elses_order(db, sos_app):
    """A guessed order id must not end up on the audit row, and must not block the alert."""
    app, bot = sos_app
    mine = _user(db)
    theirs = _user(db, phone="+998901110009")
    other_order = _order(db, passenger=theirs, from_city="Uzun", to_city="Sariosiyo")

    resp = await trigger_sos(_request(app, {"order_id": other_order.id}, user=mine))

    assert resp.status == 200
    db.expire_all()
    alert = db.query(SosAlert).one()
    # Not stapled to the stranger's ride...
    assert alert.order_id is None
    # ...and the emergency still reached the admin, without leaking the other route.
    assert len(bot.messages) == 1
    assert "Uzun" not in bot.messages[0]["text"]


async def test_unknown_order_id_still_delivers_the_alert(db, sos_app):
    """A bogus id used to persist a dangling FK (SQLite) or 500 (Postgres)."""
    app, bot = sos_app
    user = _user(db)

    resp = await trigger_sos(_request(app, {"order_id": 999999}, user=user))

    assert resp.status == 200
    db.expire_all()
    assert db.query(SosAlert).one().order_id is None
    assert len(bot.messages) == 1


async def test_driver_sos_with_own_order_succeeds(db, sos_app):
    app, bot = sos_app
    driver = _driver(db)
    order = _order(db, driver=driver)

    resp = await trigger_sos(_request(app, {"order_id": order.id}, driver=driver))

    assert resp.status == 200
    db.expire_all()
    alert = db.query(SosAlert).one()
    assert alert.order_id == order.id
    assert alert.driver_id == driver.id
    assert alert.reporter_type == "driver"


async def test_sos_without_order_id_is_allowed(db, sos_app):
    app, bot = sos_app
    user = _user(db)

    resp = await trigger_sos(_request(app, {"lat": 37.2, "lon": 67.3}, user=user))

    assert resp.status == 200
    assert len(bot.messages) == 1
    # Coordinates are turned into a clickable map link for the admin.
    assert "maps.google.com" in bot.messages[0]["text"]


async def test_non_dict_body_is_rejected_cleanly(db, sos_app):
    """Valid JSON that isn't an object used to 500 on the first data.get()."""
    app, _ = sos_app
    user = _user(db)

    resp = await trigger_sos(_request(app, [1, 2, 3], user=user))

    assert resp.status == 400
    assert db.query(SosAlert).count() == 0


async def test_non_string_note_is_rejected_cleanly(db, sos_app):
    """`{"note": {...}}` used to raise AttributeError on .strip() -> 500."""
    app, bot = sos_app
    user = _user(db)

    resp = await trigger_sos(_request(app, {"note": {"a": 1}}, user=user))

    assert resp.status == 200
    db.expire_all()
    assert db.query(SosAlert).one().note == ""
    assert len(bot.messages) == 1


async def test_unauthenticated_caller_is_rejected(db, sos_app):
    app, _ = sos_app

    resp = await trigger_sos(_request(app, {}))

    assert resp.status == 401
    assert db.query(SosAlert).count() == 0
