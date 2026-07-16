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
