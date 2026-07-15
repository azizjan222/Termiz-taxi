"""Tests for private document storage and upload content validation."""
from datetime import datetime, timedelta

from app.api.drivers import _serialize_driver
from app.api.payments import cleanup_expired_pending_payments
from app.api.uploads import (
    PRIVATE_UPLOAD_DIR,
    detect_image_extension,
    resolve_upload_path,
    serve_upload,
)
from app.models import Driver, Payment


def test_detect_image_extension_uses_magic_bytes_not_filename():
    assert detect_image_extension(b"\xff\xd8\xff" + b"x" * 20) == ".jpg"
    assert detect_image_extension(b"\x89PNG\r\n\x1a\n" + b"x" * 20) == ".png"
    assert detect_image_extension(b"RIFF\x00\x00\x00\x00WEBP" + b"x" * 20) == ".webp"
    assert detect_image_extension(b"#!/bin/sh\necho not-an-image") is None


def test_private_upload_resolution_blocks_path_traversal():
    assert resolve_upload_path("private/../../etc/passwd") is None
    resolved = resolve_upload_path("/private-uploads/document.jpg")
    assert resolved == (PRIVATE_UPLOAD_DIR / "document.jpg").resolve()


async def test_public_upload_route_denies_legacy_identity_documents_and_receipts():
    class Request:
        def __init__(self, filename):
            self.match_info = {"filename": filename}

    assert (await serve_upload(Request("driver_1_license_deadbeef.jpg"))).status == 404
    assert (await serve_upload(Request("driver_1_tech_passport_deadbeef.jpg"))).status == 404
    assert (await serve_upload(Request("topup_1_deadbeef.jpg"))).status == 404


def test_driver_serialization_uses_authenticated_document_endpoints():
    driver = Driver(
        id=1,
        telegram_id=100,
        phone="+998901234567",
        license_photo_url="/private-uploads/license.jpg",
        tech_passport_url="/private-uploads/tech.jpg",
    )
    payload = _serialize_driver(driver)

    assert payload["license_photo_url"] == "/api/driver/documents/license"
    assert payload["tech_passport_url"] == "/api/driver/documents/tech-passport"
    assert "/private-uploads/" not in str(payload)


def test_stale_manual_payment_is_cancelled_and_receipt_deleted(db, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "TOPUP_PENDING_HOURS", 24)
    driver = Driver(telegram_id=200, phone="+998901111111", balance=0)
    db.add(driver)
    db.commit()
    db.refresh(driver)

    receipt_dir = PRIVATE_UPLOAD_DIR / "receipts"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = receipt_dir / "stale-receipt.jpg"
    receipt.write_bytes(b"\xff\xd8\xfftest")
    payment = Payment(
        driver_id=driver.id,
        provider="manual_app",
        amount=10_000,
        status="pending",
        photo_file_id="private/receipts/stale-receipt.jpg",
        receipt_sha256="d" * 64,
        created_at=datetime.utcnow() - timedelta(hours=25),
    )
    db.add(payment)
    db.commit()
    payment_id = payment.id

    assert cleanup_expired_pending_payments() == 1
    db.expire_all()
    saved = db.query(Payment).filter_by(id=payment_id).one()
    assert saved.status == "cancelled"
    assert saved.processed_at is not None
    assert not receipt.exists()



def test_cleanup_never_cancels_or_deletes_a_payment_claimed_for_approval(db, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "TOPUP_PENDING_HOURS", 24)
    driver = Driver(telegram_id=201, phone="+998901111112", balance=0)
    db.add(driver)
    db.commit()
    db.refresh(driver)

    receipt_dir = PRIVATE_UPLOAD_DIR / "receipts"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = receipt_dir / "processing-receipt.jpg"
    receipt.write_bytes(b"\xff\xd8\xfftest")
    payment = Payment(
        driver_id=driver.id,
        provider="manual_app",
        amount=10_000,
        status="processing",
        photo_file_id="private/receipts/processing-receipt.jpg",
        receipt_sha256="e" * 64,
        created_at=datetime.utcnow() - timedelta(hours=25),
    )
    db.add(payment)
    db.commit()
    payment_id = payment.id

    assert cleanup_expired_pending_payments() == 0
    db.expire_all()
    assert db.query(Payment).filter_by(id=payment_id).one().status == "processing"
    assert receipt.exists()
    receipt.unlink()
