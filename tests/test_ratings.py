"""Rating endpoint tests.

`app/api/ratings.py` had no coverage at all. Its authorization, status gate, duplicate
guard and aggregate recomputation were already correct — these tests pin that behaviour so
it stays correct — plus the input-validation defects that used to produce 500s or silently
truncate a fractional star rating.
"""
import pytest

from app.api.ratings import _parse_comment, _parse_stars, passenger_rate_driver
from app.models import Driver, Order, Rating, User


def _user(db, phone="+998901110001"):
    row = User(phone=phone, first_name="Ali")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _driver(db, telegram_id=9101):
    row = Driver(telegram_id=telegram_id, phone="+998902220002", first_name="Vali")
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


@pytest.fixture(autouse=True)
def _patch_identity(monkeypatch):
    """Resolve the caller from the request stub instead of a real JWT.

    `require_auth` lives in app.utils.auth and looks `get_current_user` up in that
    module's globals at call time, so patching it there covers the decorator.
    """
    import app.utils.auth as auth_module

    monkeypatch.setattr(auth_module, "get_current_user", lambda r: r.get("_test_user"))


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
    assert db.query(Rating).one().comment == ""
