"""Tests for the admin notification fired when a driver submits their documents.

The driver could previously finish onboarding in silence: notify_admin_new_driver only fires
on bot REGISTRATION, before any document exists, so nothing announced the moment documents
actually arrived and a driver could wait for approval indefinitely.

The three properties that matter here are all failure modes rather than happy paths: it must
fire exactly ONCE (the endpoint is retryable), it must never break the submission, and it
must not put identity documents or the PINFL into a Telegram chat.
"""
import pytest

from app import config
from app.api import drivers
from app.api.drivers import _notify_admin_documents_ready, submit_documents
from app.bot import notifications
from app.models import Driver


class _FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append({"chat_id": chat_id, "text": text, **kwargs})


class _FakeApp(dict):
    pass


class _FakeRequest:
    """Minimal stand-in: the handler only uses request["driver"] and request.app.

    Mutable because @require_driver assigns request["driver"] itself — the decorator is
    left in place rather than bypassed so the test exercises the real handler.
    """

    def __init__(self, driver, app):
        self._data = {"driver": driver}
        self.app = app
        self.headers = {}

    def __getitem__(self, key):
        return self._data[key]

    def __setitem__(self, key, value):
        self._data[key] = value


def _complete_driver(db, telegram_id=8001) -> Driver:
    driver = Driver(
        telegram_id=telegram_id,
        phone="+998900000001",
        first_name="Ali",
        last_name="Valiyev",
        pinfl="12345678901234",
        car_model="Cobalt",
        car_year="2022",
        car_number="01A123BC",
        license_photo_url="/private-uploads/a.jpg",
        license_back_url="/private-uploads/b.jpg",
        tech_passport_url="/private-uploads/c.jpg",
        tech_passport_back_url="/private-uploads/d.jpg",
    )
    db.add(driver)
    db.commit()
    return driver


async def _submit(db, driver, bot, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_ID", 999)
    monkeypatch.setattr(notifications, "ADMIN_ID", 999)
    # @require_driver resolves the caller from the Authorization header; supply the driver
    # directly instead of minting a real JWT, which is not what these tests are about.
    monkeypatch.setattr(drivers, "_get_driver_from_request", lambda request: driver)
    app = _FakeApp()
    if bot is not None:
        app["bot"] = bot
    return await submit_documents(_FakeRequest(driver, app))


async def test_admin_is_notified_once_when_documents_are_submitted(db, monkeypatch):
    driver = _complete_driver(db)
    bot = _FakeBot()

    response = await _submit(db, driver, bot, monkeypatch)
    assert response.status == 200
    assert len(bot.sent) == 1

    message = bot.sent[0]
    assert message["chat_id"] == 999
    assert "Yangi haydovchi" in message["text"]
    assert "Ali" in message["text"]


async def test_repeat_submission_does_not_notify_again(db, monkeypatch):
    """The endpoint is retryable — a second tap must not ping the admin twice."""
    driver = _complete_driver(db, telegram_id=8002)
    bot = _FakeBot()

    assert (await _submit(db, driver, bot, monkeypatch)).status == 200
    assert len(bot.sent) == 1

    assert (await _submit(db, driver, bot, monkeypatch)).status == 200
    assert len(bot.sent) == 1, "documents_submitted was already true; no second message"


async def test_submission_succeeds_when_no_bot_is_attached(db, monkeypatch):
    """API-only deployments have no app["bot"]; submission must still work."""
    driver = _complete_driver(db, telegram_id=8003)

    response = await _submit(db, driver, None, monkeypatch)
    assert response.status == 200

    db.refresh(driver)
    assert driver.documents_submitted is True


async def test_a_failing_telegram_send_never_fails_the_submission(db, monkeypatch):
    class _BrokenBot:
        async def send_message(self, *args, **kwargs):
            raise RuntimeError("Telegram is down")

    driver = _complete_driver(db, telegram_id=8004)
    response = await _submit(db, driver, _BrokenBot(), monkeypatch)

    assert response.status == 200
    db.refresh(driver)
    assert driver.documents_submitted is True


async def test_incomplete_documents_are_rejected_and_nobody_is_notified(db, monkeypatch):
    driver = Driver(telegram_id=8005, phone="+998900000005")  # no documents at all
    db.add(driver)
    db.commit()
    bot = _FakeBot()

    response = await _submit(db, driver, bot, monkeypatch)
    assert response.status == 400
    assert bot.sent == []


async def test_notification_links_to_the_panel_and_leaks_no_documents(db, monkeypatch):
    driver = _complete_driver(db, telegram_id=8006)
    bot = _FakeBot()
    monkeypatch.setattr(config, "ADMIN_PANEL_URL", "https://panel.example/admin/")

    await _submit(db, driver, bot, monkeypatch)
    message = bot.sent[0]

    markup = message["reply_markup"]
    urls = [button.url for row in markup.inline_keyboard for button in row if button.url]
    assert "https://panel.example/admin/drivers" in urls

    # Identity documents and the PINFL must stay behind the authenticated panel.
    assert driver.pinfl not in message["text"]
    for field in ("license_photo_url", "tech_passport_url"):
        assert str(getattr(driver, field)) not in message["text"]


async def test_notification_is_skipped_when_no_panel_url_is_configured(db, monkeypatch):
    """A non-https / unset URL must omit the button, not break the whole message."""
    driver = _complete_driver(db, telegram_id=8007)
    bot = _FakeBot()
    monkeypatch.setattr(config, "ADMIN_PANEL_URL", "")

    await _submit(db, driver, bot, monkeypatch)
    markup = bot.sent[0]["reply_markup"]
    urls = [
        button.url
        for row in (markup.inline_keyboard if markup else [])
        for button in row
        if button.url
    ]
    assert urls == []


def test_admin_panel_url_resolves_without_any_configuration():
    """The link must work out of the box, or the feature silently ships with no button."""
    assert config.PUBLIC_BASE_URL, "PUBLIC_BASE_URL should default to this deployment's URL"
    assert config.ADMIN_PANEL_URL == f"{config.PUBLIC_BASE_URL}/admin/"
    assert config.ADMIN_PANEL_URL.startswith("https://")


async def test_admin_panel_url_is_not_taken_from_a_request_header(db, monkeypatch):
    """Guard against a tempting shortcut that would be a phishing hole.

    Deriving the base URL from the request's Host header would remove the need to configure
    anything — and would let a caller sending `Host: evil.example` put a link to
    `https://evil.example/admin/` in front of the admin, who would then type the panel
    password into it. The link must come from config, never from the request.
    """
    driver = _complete_driver(db, telegram_id=8008)
    bot = _FakeBot()

    app = _FakeApp()
    app["bot"] = bot
    request = _FakeRequest(driver, app)
    request.headers = {"Host": "evil.example", "X-Forwarded-Host": "evil.example"}

    monkeypatch.setattr(config, "ADMIN_ID", 999)
    monkeypatch.setattr(notifications, "ADMIN_ID", 999)
    monkeypatch.setattr(drivers, "_get_driver_from_request", lambda r: driver)

    assert (await submit_documents(request)).status == 200

    message = bot.sent[0]
    markup = message["reply_markup"]
    urls = [
        button.url
        for row in (markup.inline_keyboard if markup else [])
        for button in row
        if button.url
    ]
    assert urls, "the configured panel link should still be present"
    assert all("evil.example" not in url for url in urls)
    assert "evil.example" not in message["text"]


@pytest.mark.parametrize("value,expected", [
    ("https://ok.example", "https://ok.example"),
    ("https://ok.example/", "https://ok.example"),
    ("http://insecure.example", ""),
    ("", ""),
    ("   ", ""),
    ("ftp://nope.example", ""),
])
def test_https_url_filter(value, expected):
    """Telegram drops a message whose button URL is not https, so config filters it."""
    assert config._https_url(value) == expected


async def test_notify_helper_is_a_no_op_without_admin_id(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_ID", 0)
    bot = _FakeBot()
    app = _FakeApp()
    app["bot"] = bot

    await _notify_admin_documents_ready(
        _FakeRequest(None, app),
        {"driver_id": 1, "telegram_id": 2, "phone": "+998900000000", "data": {}},
    )
    assert bot.sent == []
