"""Verify the legacy taksi_baza.json -> DB migration preserves EVERY piece of bot state
and stays consistent with what BotStore (and the app) read.

This is the safety net for the "won't my data be lost?" question after moving the bot off
its JSON store: balances, bans, first-payment flags, the passenger broadcast list, the
maintenance flag and order history must all survive the migration, the migration must be
idempotent (safe to run on every startup), and it must not clobber values the bot/app
changed afterwards.
"""
import json

from app.bot.store import BotStore
from app.migrate import migrate_legacy_json
from app.models import Driver, OrderHistory, Setting


def _write_legacy(tmp_path, **overrides):
    data = {
        "haydovchilar": {"1001": "+998901112233", "1002": "+998904445566"},
        "balanslar": {"1001": 80000, "1002": 15000},
        "yolovchilar": [5001, 5002, 5003],
        "banned_users": [1002, 7777],
        "birinchi_tolov_qilganlar": [1001],
        "maintenance_mode": True,
        "haydovchi_hujjatlar": {
            "1001": {"first_name": "Ali", "last_name": "Valiyev",
                     "car_model": "Cobalt", "car_number": "90A123BC"},
        },
        "zakaslar_tarixi": [
            {"qayerdan": "Termiz", "qayerga": "Denov", "vaqt": "2026-01-01 10:00",
             "haydovchi_user": "Ali", "haydovchi_tel": "+998901112233"},
        ],
        "bekor_tarixi": [
            {"qayerdan": "Uzun", "qayerga": "Termiz", "vaqt": "2026-01-02 11:00",
             "kim": "Yo'lovchi", "tel": "+998900000000"},
        ],
    }
    data.update(overrides)
    path = tmp_path / "taksi_baza.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def test_migration_preserves_all_bot_state(db, tmp_path):
    path = _write_legacy(tmp_path)
    migrate_legacy_json(json_path=path)
    db.expire_all()

    store = BotStore()

    # Drivers + balances (from JSON balanslar).
    assert store.is_driver(1001) is True
    assert store.get_balance(1001) == 80000
    assert store.get_balance(1002) == 15000

    # Driver details backfilled from haydovchi_hujjatlar.
    d1 = db.query(Driver).filter_by(telegram_id=1001).first()
    assert d1.first_name == "Ali"
    assert d1.car_number == "90A123BC"
    assert d1.documents_submitted is True
    assert d1.is_verified is True

    # Bans preserved (driver 1002 + non-driver 7777), readable via the store.
    assert store.is_banned(1002) is True
    assert store.is_banned(7777) is True
    assert db.query(Driver).filter_by(telegram_id=1002).first().is_blocked is True

    # First-payment flag preserved on the app-shared `first_payers` key.
    assert store.has_first_payment(1001) is True
    assert store.has_first_payment(1002) is False
    assert db.query(Driver).filter_by(telegram_id=1001).one().first_payment_bonus_granted is True
    fp = db.query(Setting).filter_by(key="first_payers").first()
    assert 1001 in json.loads(fp.value)

    # Passenger broadcast list preserved.
    assert set(store.list_passenger_ids()) == {5001, 5002, 5003}

    # Maintenance flag preserved.
    assert store.is_maintenance() is True

    # History migrated.
    assert db.query(OrderHistory).filter_by(action="completed").count() == 1
    assert db.query(OrderHistory).filter_by(action="cancelled").count() == 1


def test_migration_reconciles_existing_driver_balance(db, tmp_path):
    # A driver already exists in the DB (e.g. created via the app) with a STALE balance.
    db.add(Driver(telegram_id=1001, phone="+998901112233", balance=5000))
    db.commit()

    path = _write_legacy(tmp_path)  # JSON says 1001 has 80000
    migrate_legacy_json(json_path=path)
    db.expire_all()

    # The bot's JSON balance (what the driver saw in Kabinet) wins, no money lost.
    assert BotStore().get_balance(1001) == 80000
    # No duplicate driver row was created.
    assert db.query(Driver).filter_by(telegram_id=1001).count() == 1


def test_migration_is_idempotent_and_non_destructive(db, tmp_path):
    path = _write_legacy(tmp_path)
    migrate_legacy_json(json_path=path)

    # Simulate the app appending a NEW first-payer and an admin unbanning via the bot
    # AFTER the first migration.
    store = BotStore()
    fp = db.query(Setting).filter_by(key="first_payers").first()
    fp.value = json.dumps(sorted(set(json.loads(fp.value)) | {2002}))
    db.commit()
    store.unban(7777)

    # Run the migration again (as happens on every restart).
    migrate_legacy_json(json_path=path)
    db.expire_all()

    # History was NOT duplicated.
    assert db.query(OrderHistory).count() == 2
    # The app-added first-payer survived (not clobbered by the legacy snapshot).
    assert store.has_first_payment(2002) is True
    assert store.has_first_payment(1001) is True
    # The bot-side unban survived (legacy ban was not re-applied).
    assert store.is_banned(7777) is False


def test_migration_no_json_file_is_safe(db, tmp_path):
    # Pointing at a missing file must not raise and must not invent data.
    migrate_legacy_json(json_path=str(tmp_path / "does_not_exist.json"))
    db.expire_all()
    assert db.query(Driver).count() == 0

    # The one-time empty-fleet marker prevents drivers registered after deployment
    # from being silently grandfathered on later restarts.
    new_driver = Driver(telegram_id=3003, phone="+998901113003")
    db.add(new_driver)
    db.commit()
    migrate_legacy_json(json_path=str(tmp_path / "still_missing.json"))
    db.expire_all()
    saved = db.query(Driver).filter_by(telegram_id=3003).one()
    assert saved.documents_submitted is False
    assert saved.is_verified is False
