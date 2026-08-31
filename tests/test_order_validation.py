"""Handler-level validation for POST /api/orders.

Two regressions are covered.

1. ``person_count`` was clamped for PRICING (``min(person_count, 10)``) but the raw client
   value was stored, so an order for 50 passengers was charged for 10 and displayed to the
   driver as 50. A zero/negative count fell through to a DB CheckConstraint and surfaced as
   a generic 500 -- or, on a database where that constraint had never been backfilled, was
   simply stored.

2. A VALID promo code that is worth nothing on this particular order (a parcel booking,
   whose fare is 0 until driver and passenger agree) was turned into a 400, so entering a
   working promo code made the whole booking fail.
"""
import json

import pytest

from app import config
from app.api import orders as orders_api
from app.models import Order, PromoCode, Route, User
from app.services import promo as promo_service
from app.utils import auth as auth_module


@pytest.fixture
def passenger(db):
    user = User(phone="+998901112233", first_name="Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def route(db):
    row = Route(
        from_city="Termiz", to_city="Sariosiyo", price_per_person=30000, is_active=True
    )
    db.add(row)
    db.commit()
    return row


@pytest.fixture
def as_passenger(db, passenger, monkeypatch):
    """Authenticate every request as `passenger` without minting a real JWT.

    `require_auth` resolves `get_current_user` from app.utils.auth's module globals at call
    time, so patching it there is enough.
    """
    monkeypatch.setattr(
        auth_module, "get_current_user",
        lambda request: db.query(User).filter_by(id=passenger.id).first(),
    )
    return passenger


class _JsonRequest(dict):
    """The smallest thing `create_order` accepts.

    It reads exactly two things from the request: `await request.json()` and
    `request["user"]` (set by the `require_auth` wrapper). Subclassing dict covers the
    second and avoids depending on aiohttp's StreamReader plumbing to deliver a body.
    """

    def __init__(self, body: dict):
        super().__init__()
        self._body = body

    async def json(self):
        return self._body


def _order_request(body: dict):
    return _JsonRequest(body)


async def _create(body: dict):
    response = await orders_api.create_order(_order_request(body))
    return response.status, json.loads(response.body.decode())


def _base_body(**overrides) -> dict:
    body = {
        "service_type": "taxi",
        "from_city": "Termiz",
        "to_city": "Sariosiyo",
        "person_count": 1,
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------- #
# person_count validation                                                      #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("bad", [0, -1, -50])
async def test_non_positive_person_count_is_rejected(db, as_passenger, route, bad):
    status, payload = await _create(_base_body(person_count=bad))
    assert status == 400
    assert payload["code"] == "bad_person_count"
    assert db.query(Order).count() == 0


async def test_person_count_above_cap_is_rejected(db, as_passenger, route):
    status, payload = await _create(
        _base_body(person_count=config.MAX_PERSONS_PER_ORDER + 1)
    )
    assert status == 400
    assert payload["code"] == "bad_person_count"
    assert db.query(Order).count() == 0


async def test_person_count_at_cap_is_accepted_and_priced_in_full(db, as_passenger, route):
    """The core regression: what is charged must match what is stored."""
    status, payload = await _create(
        _base_body(person_count=config.MAX_PERSONS_PER_ORDER)
    )
    assert status == 201

    saved = db.query(Order).one()
    assert saved.person_count == config.MAX_PERSONS_PER_ORDER
    assert saved.price == 30000 * config.MAX_PERSONS_PER_ORDER
    assert payload["order"]["person_count"] == config.MAX_PERSONS_PER_ORDER


async def test_non_numeric_person_count_is_a_400_not_a_500(db, as_passenger, route):
    status, payload = await _create(_base_body(person_count="ko'p"))
    assert status == 400
    assert payload["code"] == "bad_person_count"


async def test_negative_gender_counts_are_rejected(db, as_passenger, route):
    status, payload = await _create(_base_body(male_count=-1))
    assert status == 400
    assert payload["code"] == "bad_person_count"
    assert db.query(Order).count() == 0


async def test_gender_counts_are_stored_as_validated(db, as_passenger, route):
    status, _ = await _create(_base_body(person_count=3, male_count=2, female_count=1))
    assert status == 201
    saved = db.query(Order).one()
    assert (saved.male_count, saved.female_count) == (2, 1)


# --------------------------------------------------------------------------- #
# promo code that cannot pay out on this order                                 #
# --------------------------------------------------------------------------- #

def _promo(db, code="TEST10", percent=10):
    row = PromoCode(code=code, discount_percent=percent, is_active=True, max_uses=0)
    db.add(row)
    db.commit()
    return row


async def test_valid_promo_on_parcel_still_creates_the_order(db, as_passenger, route):
    """A parcel fare is 0, so the code is worth 0 -- that must not lose the booking."""
    _promo(db)

    status, payload = await _create(_base_body(service_type="parcel", promo_code="TEST10"))

    assert status == 201, "a valid promo code must never prevent a parcel booking"
    saved = db.query(Order).one()
    assert saved.service_type == "parcel"
    assert saved.promo_discount == 0
    assert saved.promo_code is None
    # The passenger typed a code and was shown a discount, so silence would look like it
    # had been applied.
    assert payload["promo_warning"] == promo_service.NOT_APPLICABLE


async def test_unknown_promo_code_is_still_a_hard_error(db, as_passenger, route):
    status, payload = await _create(_base_body(promo_code="NOPESUCHCODE"))
    assert status == 400
    assert payload["error"] != promo_service.NOT_APPLICABLE
    assert db.query(Order).count() == 0


async def test_applicable_promo_is_redeemed_normally(db, as_passenger, route):
    _promo(db, code="TAXI10", percent=10)

    status, payload = await _create(_base_body(promo_code="TAXI10"))

    assert status == 201
    saved = db.query(Order).one()
    assert saved.promo_code == "TAXI10"
    assert saved.promo_discount > 0
    assert "promo_warning" not in payload
