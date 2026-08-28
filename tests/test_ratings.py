"""Rating endpoint tests.

`app/api/ratings.py` had no coverage at all. Its authorization, status gate, duplicate
guard and aggregate recomputation were already correct — these tests pin that behaviour so
it stays correct — plus the input-validation defects that used to produce 500s or silently
truncate a fractional star rating.
"""
import pytest

import app.api.ratings as ratings_api
from app.api.ratings import _parse_comment, _parse_stars, passenger_rate_driver
from app.models import Driver, Order, Rating, User


def _user(db, phone="+998901110001"):
    row = User(phone=phone, first_name="Ali")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _driver(db, telegram_id=9101):
    # Driver.phone is UNIQUE, so it has to vary with telegram_id — a second _driver() call
    # in the same test would otherwise fail on the constraint rather than on the assertion.
    row = Driver(
        telegram_id=telegram_id,
        phone=f"+9989022{telegram_id:05d}",
        first_name="Vali",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _order(db, *, passenger, driver, status="completed"):
    row = Order(
        passenger_id=passenger.id if passenger else None,
        # NOT NULL on the orders table.
        passenger_phone=passenger.phone if passenger else "+998900000000",
        driver_id=driver.id if driver else None,
        from_city="Termiz",
        to_city="Denov",
        person_count=1,
        price=90000,
        commission=9000,
        status=status,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _request(body, *, user, order_id):
    class _Req:
        def __init__(self):
            self.match_info = {"id": str(order_id)}
            self._body = body
            # `require_auth` writes request["user"] after resolving the token.
            self._store = {"_test_user": user}

        async def json(self):
            return self._body

        def __getitem__(self, key):
            return self._store[key]

        def __setitem__(self, key, value):
            self._store[key] = value

        def get(self, key, default=None):
            return self._store.get(key, default)

    return _Req()


def _driver_request(body, *, driver, order_id):
    """Request stub for the driver-side handler.

    `driver_rate_passenger` is not decorated: it calls `_get_driver_from_request(request)`
    itself, and the autouse fixture below patches that name inside app.api.ratings.
    """
    class _Req:
        def __init__(self):
            self.match_info = {"id": str(order_id)}
            self._body = body
            self._store = {"_test_driver": driver}

        async def json(self):
            return self._body

        def __getitem__(self, key):
            return self._store[key]

        def __setitem__(self, key, value):
            self._store[key] = value

        def get(self, key, default=None):
            return self._store.get(key, default)

    return _Req()


@pytest.fixture(autouse=True)
def _patch_identity(monkeypatch):
    """Resolve the caller from the request stub instead of a real JWT.

    `require_auth` lives in app.utils.auth and looks `get_current_user` up in that
    module's globals at call time, so patching it there covers the decorator.

    `_get_driver_from_request` is imported INTO app.api.ratings at module load, so it has to
    be patched there rather than at its definition site.
    """
    import app.utils.auth as auth_module

    monkeypatch.setattr(auth_module, "get_current_user", lambda r: r.get("_test_user"))
    monkeypatch.setattr(
        ratings_api, "_get_driver_from_request", lambda r: r.get("_test_driver")
    )


def _handler():
    return passenger_rate_driver


class TestParseStars:
    """int() used to accept these silently."""

    @pytest.mark.parametrize("raw,expected", [(1, 1), (5, 5), ("4", 4), (" 3 ", 3)])
    def test_accepts_whole_stars(self, raw, expected):
        assert _parse_stars(raw) == expected

    @pytest.mark.parametrize("raw", [4.9, 0.5, True, False, None, "abc", "", {}, [], 0, 6, -1])
    def test_rejects_everything_else(self, raw):
        assert _parse_stars(raw) is None


class TestParseComment:
    def test_trims_and_caps(self):
        assert _parse_comment("  hi  ") == "hi"
        assert len(_parse_comment("x" * 900)) == 500

    @pytest.mark.parametrize("raw", [None, {"a": 1}, [1], 5])
    def test_non_string_becomes_empty(self, raw):
        """`(raw or "").strip()` raised AttributeError on these -> 500."""
        assert _parse_comment(raw) == ""


async def test_passenger_can_rate_own_completed_order(db):
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    resp = await _handler()(_request({"stars": 5, "comment": "Zo'r"}, user=user, order_id=order.id))

    assert resp.status == 200
    db.expire_all()
    rating = db.query(Rating).one()
    assert rating.stars == 5
    assert rating.order_id == order.id
    # The driver aggregate is recomputed from rows, so it must reflect the single rating.
    assert db.query(Driver).filter_by(id=driver.id).one().rating_count == 1


async def test_cannot_rate_someone_elses_order(db):
    mine = _user(db)
    theirs = _user(db, phone="+998901110009")
    driver = _driver(db)
    other_order = _order(db, passenger=theirs, driver=driver)

    resp = await _handler()(_request({"stars": 5}, user=mine, order_id=other_order.id))

    assert resp.status == 404
    assert db.query(Rating).count() == 0


@pytest.mark.parametrize("status", ["new", "accepted", "in_progress", "cancelled", "expired"])
async def test_cannot_rate_an_unfinished_order(db, status):
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver, status=status)

    resp = await _handler()(_request({"stars": 5}, user=user, order_id=order.id))

    assert resp.status == 400
    assert db.query(Rating).count() == 0


async def test_second_rating_for_the_same_order_is_rejected(db):
    """The unique constraint must stop a rating being counted twice."""
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    first = await _handler()(_request({"stars": 5}, user=user, order_id=order.id))
    second = await _handler()(_request({"stars": 1}, user=user, order_id=order.id))

    assert first.status == 200
    assert second.status == 409
    db.expire_all()
    assert db.query(Rating).count() == 1
    # The 1-star retry must not have dragged the average down.
    assert db.query(Driver).filter_by(id=driver.id).one().rating == 5.0


async def test_fractional_stars_are_rejected_not_truncated(db):
    """`{"stars": 4.9}` used to be stored as 4."""
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    resp = await _handler()(_request({"stars": 4.9}, user=user, order_id=order.id))

    assert resp.status == 400
    assert db.query(Rating).count() == 0


async def test_non_dict_body_is_rejected_cleanly(db):
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    resp = await _handler()(_request([1, 2, 3], user=user, order_id=order.id))

    assert resp.status == 400
    assert db.query(Rating).count() == 0


async def test_dict_comment_does_not_crash(db):
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    resp = await _handler()(
        _request({"stars": 4, "comment": {"a": 1}}, user=user, order_id=order.id)
    )

    assert resp.status == 200
    db.expire_all()
    # The non-string comment is dropped rather than crashing, and an empty comment is
    # stored as NULL (the handler's existing `comment if comment else None`) so the column
    # never holds a meaningless empty string.
    assert db.query(Rating).one().comment is None



# ===================== rating exposed to the driver app =====================

def test_driver_payload_exposes_rating_and_count(db):
    """The driver profile screen needs BOTH numbers to show an honest rating.

    Driver.rating defaults to 5.0, so the average alone cannot distinguish a brand-new
    driver from one who earned 5.0 across 40 rides. The profile screen used to sidestep
    that by hardcoding "4.0" for everyone; it now relies on rating_count being served
    here, so this pins the field in place.
    """
    from app.api.drivers import _serialize_driver

    driver = _driver(db)
    payload = _serialize_driver(driver)

    assert payload["rating_count"] == 0
    assert "rating" in payload

    driver.rating = 4.75
    driver.rating_count = 12
    db.commit()

    payload = _serialize_driver(driver)
    assert payload["rating"] == 4.75
    assert payload["rating_count"] == 12


def test_driver_payload_rating_count_is_zero_not_null_for_legacy_rows(db):
    """Legacy rows predate the column and read back as NULL; the app expects a number."""
    from app.api.drivers import _serialize_driver

    driver = _driver(db)
    driver.rating_count = None
    db.commit()

    assert _serialize_driver(driver)["rating_count"] == 0



# ============ can_rate_passenger: whether the driver app offers a rating ============

def test_order_payload_allows_rating_when_passenger_has_an_account(db):
    from app.api.drivers import _serialize_order

    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    assert _serialize_order(order)["can_rate_passenger"] is True


def test_order_payload_forbids_rating_a_bot_order_with_no_passenger_account(db):
    """Bot-placed rides often carry only a Telegram id and no User row.

    ``driver_rate_passenger`` requires ``Order.passenger_id`` and answers 400 without it, so
    the app must not open a rating screen whose only possible outcome is that error.
    """
    from app.api.drivers import _serialize_order

    driver = _driver(db)
    order = Order(
        passenger_id=None,
        passenger_telegram_id=555123,
        passenger_phone="+998901112233",
        driver_id=driver.id,
        from_city="Termiz",
        to_city="Denov",
        status="completed",
        source="bot",
    )
    db.add(order)
    db.commit()

    assert _serialize_order(order)["can_rate_passenger"] is False


async def test_driver_can_rate_own_completed_order(db):
    """The driver -> passenger half of the system had a backend endpoint, DB columns and an
    API client, but no caller anywhere — so User.rating never moved off its 5.0 default.
    """
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    resp = await ratings_api.driver_rate_passenger(
        _driver_request({"stars": 4, "comment": "Yaxshi yo'lovchi"}, driver=driver,
                        order_id=order.id)
    )

    assert resp.status == 200
    db.expire_all()
    fresh = db.query(User).filter_by(id=user.id).one()
    assert fresh.rating == 4.0
    assert fresh.rating_count == 1


async def test_driver_cannot_rate_a_passenger_twice(db):
    user = _user(db)
    driver = _driver(db)
    order = _order(db, passenger=user, driver=driver)

    first = await ratings_api.driver_rate_passenger(
        _driver_request({"stars": 5}, driver=driver, order_id=order.id)
    )
    assert first.status == 200

    second = await ratings_api.driver_rate_passenger(
        _driver_request({"stars": 1}, driver=driver, order_id=order.id)
    )
    assert second.status == 409

    db.expire_all()
    fresh = db.query(User).filter_by(id=user.id).one()
    assert fresh.rating_count == 1
    assert fresh.rating == 5.0


async def test_driver_cannot_rate_someone_elses_order(db):
    user = _user(db)
    mine = _driver(db)
    theirs = _driver(db, telegram_id=9202)
    order = _order(db, passenger=user, driver=theirs)

    resp = await ratings_api.driver_rate_passenger(
        _driver_request({"stars": 5}, driver=mine, order_id=order.id)
    )

    assert resp.status == 404
    assert db.query(Rating).count() == 0
