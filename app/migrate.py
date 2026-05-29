"""Migrate data from legacy taksi_baza.json to SQLite database."""
import json
import os
from datetime import datetime

from app.database import init_db, DbContext
from app.models import Driver, Setting, OrderHistory
from app.seed_data import seed_routes
from app.config import LEGACY_JSON_PATH


def parse_legacy_datetime(value) -> "datetime | None":
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def migrate_legacy_json(json_path: str = LEGACY_JSON_PATH) -> dict:
    """Read legacy JSON file and migrate to SQLite. Returns counts."""
    counts = {
        "drivers": 0,
        "history": 0,
        "settings": 0,
        "routes": 0,
    }

    # Always seed routes (even if no legacy JSON)
    with DbContext() as session:
        counts["routes"] = seed_routes(session)

    if not os.path.exists(json_path):
        # Try local path as fallback
        local_path = "./data/taksi_baza.json"
        if os.path.exists(local_path):
            json_path = local_path
        else:
            print(f"⚠️  Legacy JSON not found at {json_path}, skipping JSON migration")
            return counts

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Failed to read JSON: {e}")
        return counts

    with DbContext() as session:
        # 1. Drivers
        haydovchilar = data.get("haydovchilar", {})
        balanslar = data.get("balanslar", {})
        banned_users = set(data.get("banned_users", []))

        for tg_id_str, phone in haydovchilar.items():
            try:
                tg_id = int(tg_id_str)
            except (ValueError, TypeError):
                continue

            existing = session.query(Driver).filter_by(telegram_id=tg_id).first()
            if existing:
                continue

            driver = Driver(
                telegram_id=tg_id,
                phone=str(phone),
                balance=int(balanslar.get(str(tg_id), balanslar.get(tg_id, 0))),
                is_blocked=tg_id in banned_users,
            )
            session.add(driver)
            counts["drivers"] += 1

        # 2. Order history (completed)
        for h in data.get("zakaslar_tarixi", []):
            entry = OrderHistory(
                action="completed",
                from_city=h.get("qayerdan", ""),
                to_city=h.get("qayerga", ""),
                actor=h.get("haydovchi_user", ""),
                actor_phone=h.get("haydovchi_tel", ""),
                timestamp=parse_legacy_datetime(h.get("vaqt")) or datetime.utcnow(),
            )
            session.add(entry)
            counts["history"] += 1

        # 3. Cancellation history
        for b in data.get("bekor_tarixi", []):
            entry = OrderHistory(
                action="cancelled",
                from_city=b.get("qayerdan", ""),
                to_city=b.get("qayerga", ""),
                actor=b.get("kim", ""),
                actor_phone=b.get("tel", ""),
                timestamp=parse_legacy_datetime(b.get("vaqt")) or datetime.utcnow(),
            )
            session.add(entry)
            counts["history"] += 1

        # 4. Settings
        settings_to_save = {
            "stat_zakaslar": str(data.get("stat_zakaslar", 0)),
            "stat_cheklar": str(data.get("stat_cheklar", 0)),
            "zakas_raqami": str(data.get("zakas_raqami", 0)),
            "maintenance_mode": str(data.get("maintenance_mode", False)).lower(),
            "first_payers": json.dumps(data.get("birinchi_tolov_qilganlar", [])),
        }
        for key, value in settings_to_save.items():
            existing = session.query(Setting).filter_by(key=key).first()
            if existing:
                existing.value = value
            else:
                session.add(Setting(key=key, value=value))
            counts["settings"] += 1

        # 5. Seed routes if empty (already seeded above, but safe to call again)
        # counts["routes"] is already set above
        pass

    return counts


def run_migration():
    """Run full migration: init schema, then migrate JSON."""
    print("🔄 Initializing database schema...")
    init_db()
    print("✅ Schema created.")

    print("🔄 Migrating legacy data...")
    counts = migrate_legacy_json()

    print("\n📊 Migration summary:")
    print(f"   Drivers:     {counts['drivers']}")
    print(f"   History:     {counts['history']}")
    print(f"   Settings:    {counts['settings']}")
    print(f"   Routes:      {counts['routes']}")
    print("\n✅ Migration complete!")
    return counts


if __name__ == "__main__":
    run_migration()
