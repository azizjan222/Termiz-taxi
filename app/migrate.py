"""Migrate data from legacy taksi_baza.json to SQLite database."""
import json
import os
from datetime import datetime

from app.config import LEGACY_JSON_PATH
from app.database import DbContext, engine, init_db
from app.models import Driver, OrderHistory, Setting
from app.seed_data import seed_routes


def _apply_schema_migrations() -> int:
    """Add new columns to existing tables if they don't exist.

    Works on BOTH SQLite and Postgres. Column existence is detected with SQLAlchemy's
    Inspector (dialect-agnostic) and types are written portably. Previously this skipped
    Postgres entirely, leaving an existing Postgres DB missing the newer columns -> every
    Driver/User query failed (500) and the apps hung forever on "waiting for Telegram
    confirmation". This now migrates Postgres too.
    """
    from sqlalchemy import inspect, text

    is_pg = engine.dialect.name == "postgresql"
    BOOL_FALSE = "BOOLEAN DEFAULT FALSE" if is_pg else "BOOLEAN DEFAULT 0"
    DT = "TIMESTAMP" if is_pg else "DATETIME"
    FLT = "DOUBLE PRECISION" if is_pg else "FLOAT"

    migrations = [
        # User new columns
        ("users", "rating", f"{FLT} DEFAULT 5.0"),
        ("users", "rating_count", "INTEGER DEFAULT 0"),
        ("users", "push_token", "VARCHAR(200)"),
        ("users", "referral_code", "VARCHAR(20)"),
        ("users", "referred_by_user_id", "INTEGER"),
        ("users", "referral_count", "INTEGER DEFAULT 0"),
        ("users", "referral_bonus_earned", "INTEGER DEFAULT 0"),
        ("users", "theme", "VARCHAR(20) DEFAULT 'auto'"),
        ("users", "profile_photo_url", "VARCHAR(500)"),
        ("users", "contact_phone", "VARCHAR(20)"),
        # Driver new columns
        ("drivers", "car_photo_url", "VARCHAR(500)"),
        ("drivers", "license_photo_url", "VARCHAR(500)"),
        ("drivers", "license_back_url", "VARCHAR(500)"),
        ("drivers", "tech_passport_url", "VARCHAR(500)"),
        ("drivers", "tech_passport_back_url", "VARCHAR(500)"),
        ("drivers", "profile_photo_url", "VARCHAR(500)"),
        ("drivers", "contact_phone", "VARCHAR(20)"),
        ("drivers", "seats", "INTEGER DEFAULT 4"),
        ("drivers", "is_verified", BOOL_FALSE),
        ("drivers", "rating_count", "INTEGER DEFAULT 0"),
        ("drivers", "push_token", "VARCHAR(200)"),
        ("drivers", "theme", "VARCHAR(20) DEFAULT 'auto'"),
        ("drivers", "language", "VARCHAR(10) DEFAULT 'uz'"),
        ("drivers", "subscription_until", DT),
        ("drivers", "car_year", "VARCHAR(10)"),
        ("drivers", "pinfl", "VARCHAR(20)"),
        ("drivers", "license_file_id", "VARCHAR(200)"),
        ("drivers", "tech_passport_file_id", "VARCHAR(200)"),
        ("drivers", "car_photo_file_id", "VARCHAR(200)"),
        ("drivers", "documents_submitted", BOOL_FALSE),
        # Live location + online-time tracking
        ("drivers", "current_lat", FLT),
        ("drivers", "current_lon", FLT),
        ("drivers", "location_updated_at", DT),
        ("drivers", "online_seconds_today", "INTEGER DEFAULT 0"),
        ("drivers", "online_since", DT),
        ("drivers", "online_day", "VARCHAR(10)"),
        # Order new columns
        ("orders", "target_driver_id", "INTEGER"),
        ("orders", "commission_charged", BOOL_FALSE),
        ("orders", "commission_collected", BOOL_FALSE),
        ("orders", "commission_warned", BOOL_FALSE),
    ]

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    existing_cols: dict = {}
    for table, _, _ in migrations:
        if table not in existing_cols:
            existing_cols[table] = (
                {c["name"] for c in inspector.get_columns(table)}
                if table in table_names else set()
            )

    count = 0
    with engine.connect() as conn:
        for table, column, definition in migrations:
            if not existing_cols.get(table):
                continue  # table will be fully built by create_all
            if column in existing_cols[table]:
                continue
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
                conn.commit()
                count += 1
                existing_cols[table].add(column)
                print(f"  ✓ Added {table}.{column}")
            except Exception as e:
                conn.rollback()
                print(f"  ⚠️  Skipping {table}.{column}: {e}")

    return count


def _grandfather_existing_drivers():
    """One-time backfill: mark all pre-existing drivers as documents_submitted=True so the
    new documents gate does not lock out the current driver base. Guarded by a Setting flag,
    so it runs only once; drivers created afterwards must go through the new registration."""
    try:
        with DbContext() as session:
            flag = session.query(Setting).filter_by(key="docs_backfill_done").first()
            if flag:
                return
            session.query(Driver).update(
                {Driver.documents_submitted: True}, synchronize_session=False
            )
            session.add(Setting(key="docs_backfill_done", value="1"))
            print("  \u2713 Grandfathered existing drivers (documents_submitted=True)")
    except Exception as e:
        print(f"  \u26a0\ufe0f  docs backfill skipped: {e}")


def _upsert_setting(session, key: str, value: str) -> None:
    """Insert or overwrite a scalar Setting row."""
    row = session.query(Setting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        session.add(Setting(key=key, value=value))


def _merge_id_setting(session, key: str, legacy_ids) -> None:
    """Union legacy integer ids into a JSON-list Setting WITHOUT dropping existing ones.

    Used for `first_payers`, `bot_banned_ids`, `bot_passenger_ids`. A plain overwrite
    would erase ids the app/bot added on their own (e.g. the mobile app appends to
    `first_payers` when it credits a payment), so we merge instead of replace.
    """
    existing_raw = None
    row = session.query(Setting).filter_by(key=key).first()
    if row and row.value:
        existing_raw = row.value

    merged: set[int] = set()
    if existing_raw:
        try:
            merged = {int(x) for x in json.loads(existing_raw)}
        except (ValueError, TypeError):
            merged = set()
    for x in legacy_ids or []:
        try:
            merged.add(int(x))
        except (ValueError, TypeError):
            continue

    payload = json.dumps(sorted(merged))
    if row:
        row.value = payload
    else:
        session.add(Setting(key=key, value=payload))


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
        "schema_updated": 0,
    }

    # IMPORTANT: schema migration must run FIRST and in isolation. If anything else
    # (seed_routes, grandfather, JSON import) raised before the ALTER TABLEs ran, the
    # DB would be left missing the newer columns and every Driver/User/Order query
    # would 500 — which looks like "orders don't work / online toggle broken" in the
    # apps no matter how many times they're rebuilt. So we add the columns up front,
    # guarded so one failure can't block the others.
    try:
        counts["schema_updated"] = _apply_schema_migrations()
    except Exception as e:
        print(f"❌ Schema migration error: {e}")

    # Seed routes (isolated so a failure here can't skip later steps).
    try:
        with DbContext() as session:
            counts["routes"] = seed_routes(session)
    except Exception as e:
        print(f"⚠️  seed_routes skipped: {e}")

    # One-time grandfather of existing drivers so the documents gate doesn't lock them out
    try:
        _grandfather_existing_drivers()
    except Exception as e:
        print(f"⚠️  grandfather skipped: {e}")

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

    haydovchi_hujjatlar = data.get("haydovchi_hujjatlar", {})

    with DbContext() as session:
        # Guard: the destructive / duplicating steps (history import, balance
        # reconciliation, collection-setting merges) must run EXACTLY ONCE. Without this,
        # run_migration() — which runs on every startup — would re-append the same history
        # rows on every restart (inflating stats) and could clobber values the bot/app
        # changed after the migration (e.g. re-ban someone an admin unbanned, or reset
        # `first_payers` the app appended to). Driver CREATION stays idempotent-by-existence
        # and can safely run every time.
        first_import = (
            session.query(Setting).filter_by(key="legacy_json_imported").first() is None
        )

        # 1. Drivers
        haydovchilar = data.get("haydovchilar", {})
        balanslar = data.get("balanslar", {})
        banned_users = {
            int(x) for x in data.get("banned_users", [])
            if str(x).lstrip("-").isdigit()
        }

        def _json_balance(tg_id: int) -> int:
            return int(balanslar.get(str(tg_id), balanslar.get(tg_id, 0)) or 0)

        def _details(tg_id: int) -> dict:
            d = haydovchi_hujjatlar.get(str(tg_id)) or haydovchi_hujjatlar.get(tg_id) or {}
            return d if isinstance(d, dict) else {}

        detail_fields = ("first_name", "last_name", "pinfl", "car_number",
                         "car_model", "car_year")

        for tg_id_str, phone in haydovchilar.items():
            try:
                tg_id = int(tg_id_str)
            except (ValueError, TypeError):
                continue

            det = _details(tg_id)
            existing = session.query(Driver).filter_by(telegram_id=tg_id).first()
            if existing:
                # Reconcile ONCE. The bot's JSON balance is what the driver saw in their
                # Kabinet, so we adopt it as the single DB balance and log any divergence
                # for the admin to audit (dual storage means the two could differ).
                if first_import:
                    json_balance = _json_balance(tg_id)
                    if json_balance != int(existing.balance or 0):
                        print(f"  ⚖️  balance reconcile tg={tg_id}: "
                              f"db={existing.balance} -> json={json_balance}")
                        existing.balance = json_balance
                    if tg_id in banned_users:
                        existing.is_blocked = True
                    # Backfill missing detail fields only (never overwrite good data).
                    for field in detail_fields:
                        if not getattr(existing, field, None) and det.get(field):
                            setattr(existing, field, det.get(field))
                continue

            driver = Driver(
                telegram_id=tg_id,
                phone=str(phone),
                balance=_json_balance(tg_id),
                is_blocked=tg_id in banned_users,
                first_name=det.get("first_name"),
                last_name=det.get("last_name"),
                pinfl=det.get("pinfl"),
                car_number=det.get("car_number"),
                car_model=det.get("car_model"),
                car_year=det.get("car_year"),
            )
            session.add(driver)
            counts["drivers"] += 1

        # 2+3. Order history — first import ONLY (otherwise rows duplicate every restart).
        if first_import:
            for h in data.get("zakaslar_tarixi", []):
                session.add(OrderHistory(
                    action="completed",
                    from_city=h.get("qayerdan", ""),
                    to_city=h.get("qayerga", ""),
                    actor=h.get("haydovchi_user", ""),
                    actor_phone=h.get("haydovchi_tel", ""),
                    timestamp=parse_legacy_datetime(h.get("vaqt")) or datetime.utcnow(),
                ))
                counts["history"] += 1
            for b in data.get("bekor_tarixi", []):
                session.add(OrderHistory(
                    action="cancelled",
                    from_city=b.get("qayerdan", ""),
                    to_city=b.get("qayerga", ""),
                    actor=b.get("kim", ""),
                    actor_phone=b.get("tel", ""),
                    timestamp=parse_legacy_datetime(b.get("vaqt")) or datetime.utcnow(),
                ))
                counts["history"] += 1

        # 4+5. Settings — first import ONLY, so we never overwrite live values the
        # bot/app changed afterwards (maintenance toggled in the bot, first_payers the
        # app appended to, someone unbanned via the bot, ...). Collection keys are
        # MERGED (union) with anything already stored, matching the keys the BotStore and
        # the app payment code read: `first_payers`, `bot_banned_ids`, `bot_passenger_ids`.
        if first_import:
            for key, value in {
                "stat_zakaslar": str(data.get("stat_zakaslar", 0)),
                "stat_cheklar": str(data.get("stat_cheklar", 0)),
                "zakas_raqami": str(data.get("zakas_raqami", 0)),
                "maintenance_mode": str(data.get("maintenance_mode", False)).lower(),
            }.items():
                _upsert_setting(session, key, value)
                counts["settings"] += 1

            _merge_id_setting(session, "first_payers",
                              data.get("birinchi_tolov_qilganlar", []))
            _merge_id_setting(session, "bot_banned_ids", data.get("banned_users", []))
            _merge_id_setting(session, "bot_passenger_ids", data.get("yolovchilar", []))
            counts["settings"] += 3

            session.add(Setting(key="legacy_json_imported", value="1"))

    return counts


def run_migration():
    """Run full migration: init schema, then migrate JSON."""
    print("🔄 Initializing database schema...")
    init_db()
    print("✅ Schema created.")

    # Add any missing columns to pre-existing tables IMMEDIATELY after create_all,
    # before any data step, so the schema is always correct even if later steps fail.
    try:
        added = _apply_schema_migrations()
        print(f"✅ Schema columns ensured (added {added}).")
    except Exception as e:
        print(f"❌ Schema migration error: {e}")

    print("🔄 Migrating legacy data...")
    counts = migrate_legacy_json()

    print("\n📊 Migration summary:")
    print(f"   Drivers:        {counts['drivers']}")
    print(f"   History:        {counts['history']}")
    print(f"   Settings:       {counts['settings']}")
    print(f"   Routes:         {counts['routes']}")
    print(f"   Schema updated: {counts['schema_updated']}")
    print("\n✅ Migration complete!")
    return counts


if __name__ == "__main__":
    run_migration()
