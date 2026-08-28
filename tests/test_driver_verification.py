"""Regression tests for the administrator-controlled driver verification gate."""
from aiohttp.test_utils import TestClient, TestServer

from app.api.drivers import _create_driver_token
from app.api.server import create_app
from app.models import Driver, Order


async def _client() -> TestClient:
    client = TestClient(TestServer(create_app()))
    await client.start_server()
    return client


async def test_unverified_driver_cannot_go_online_or_accept_orders(db):
    driver = Driver(
        telegram_id=88001,
        phone="+998900088001",
        first_name="Kutilmoqda",
        balance=100000,
        documents_submitted=True,
        is_verified=False,
    )
    order = Order(
        passenger_phone="+998900099001",
        passenger_name="Yo'lovchi",
        service_type="taxi",
        from_city="Termiz",
        to_city="Denov",
        person_count=1,
        price=50000,
        commission=5000,
        status="new",
        source="app",
    )
    db.add_all([driver, order])
    db.commit()
    db.refresh(driver)
    db.refresh(order)

    headers = {"Authorization": f"Bearer {_create_driver_token(driver)}"}
    client = await _client()
    try:
        online = await client.post(
            "/api/driver/online",
            json={"online": True},
            headers=headers,
        )
        assert online.status == 403
        assert (await online.json())["code"] == "verification_pending"

        available = await client.get("/api/driver/orders/available", headers=headers)
        assert available.status == 200
        available_data = await available.json()
        assert available_data["orders"] == []
        assert available_data["can_receive"] is False
        assert available_data["code"] == "verification_pending"

        accepted = await client.post(
            f"/api/driver/orders/{order.id}/accept",
            headers=headers,
        )
        assert accepted.status == 403
        assert (await accepted.json())["code"] == "verification_pending"

        db.expire_all()
        assert db.query(Order).filter_by(id=order.id).one().status == "new"
        assert db.query(Driver).filter_by(id=driver.id).one().is_online is False
    finally:
        await client.close()


async def test_admin_verified_driver_can_go_online(db):
    driver = Driver(
        telegram_id=88002,
        phone="+998900088002",
        first_name="Tasdiqlangan",
        documents_submitted=True,
        is_verified=True,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)

    headers = {"Authorization": f"Bearer {_create_driver_token(driver)}"}
    client = await _client()
    try:
        response = await client.post(
            "/api/driver/online",
            json={"online": True},
            headers=headers,
        )
        assert response.status == 200
        assert (await response.json())["is_online"] is True
    finally:
        await client.close()



# ===================== balance floor for accepting orders =====================
#
# Policy, set deliberately: a driver whose balance has gone NEGATIVE is not blocked — their
# account stays usable, they keep their history, and the debt is not forgiven — but they
# stop receiving work until they top back up to the floor. The floor is one taxi commission
# (config.MIN_DRIVER_BALANCE, 10 000), not two, so a solvent driver is never left idle.


def _funded_driver(balance: int, *, verified: bool = True, telegram_id: int = 88900) -> Driver:
    """An in-memory driver; driver_can_accept() touches no session."""
    return Driver(
        telegram_id=telegram_id,
        phone=f"+9989000{telegram_id}",
        first_name="Test",
        balance=balance,
        is_verified=verified,
    )


def test_default_balance_floor_is_one_commission():
    """Pins the policy number itself: 10 000, not the old 20 000."""
    from app import config

    assert config.MIN_DRIVER_BALANCE == 10000


def test_negative_balance_cannot_accept_orders():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(-5000), min_balance=10000) is False


def test_zero_balance_cannot_accept_orders():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(0), min_balance=10000) is False


def test_balance_below_floor_cannot_accept_orders():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(9999), min_balance=10000) is False


def test_balance_at_floor_can_accept_orders():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(10000), min_balance=10000) is True


def test_balance_above_floor_can_accept_orders():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(25000), min_balance=10000) is True


def test_free_trial_overrides_a_negative_balance():
    """On the free trial the driver owes no commission, so the floor does not apply."""
    from datetime import datetime, timedelta

    from app.api.drivers import driver_can_accept

    driver = _funded_driver(-9000)
    driver.subscription_until = datetime.utcnow() + timedelta(days=3)
    assert driver_can_accept(driver, min_balance=10000) is True


def test_negative_balance_does_not_block_the_account():
    """Being below the floor must never look like a ban: is_blocked stays untouched."""
    from app.api.drivers import driver_can_accept

    driver = _funded_driver(-20000)
    driver_can_accept(driver, min_balance=10000)
    assert not driver.is_blocked


def test_unverified_driver_cannot_accept_however_funded():
    from app.api.drivers import driver_can_accept

    assert driver_can_accept(_funded_driver(500000, verified=False), min_balance=10000) is False
