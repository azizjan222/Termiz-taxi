"""Migrate data from legacy taksi_baza.json to SQLite database."""
import json
import os
from datetime import datetime, timedelta

from app import config
from app.config import LEGACY_JSON_PATH
from app.database import DbContext, engine, init_db
from app.models import Driver, Order, OrderHistory, Setting
from app.seed_data import seed_routes

#: Current schema revision. Bump this together with any change to the `migrations` list
#: or the index/dedup block in `_apply_schema_migrations()`.
#:
#: The readiness probe imports this instead of repeating the number, because the two
#: constants had already drifted apart once: `/ready` still demanded 2026071501 after the
#: migration list had moved on, so a database missing the newer columns was reported
#: ready. Forgetting to bump it can no longer hide a missing COLUMN either -- the
#: additive column pass below always runs (see the comment there).
SCHEMA_VERSION = 2026082701
SCHEMA_NAME = "announcement_inbox"


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
    migration_version = SCHEMA_VERSION
    migration_name = SCHEMA_NAME

    # This is a lightweight, explicit migration ledger for the existing additive
    # migration system. It is intentionally not presented as an Alembic conversion.
    # A failed step is never marked applied, so startup retries it instead of silently
    # claiming that a partially migrated database is current.
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, name VARCHAR(200) NOT NULL, "
            "applied_at TIMESTAMP NOT NULL)"
        ))
        already_applied = conn.execute(
            text("SELECT 1 FROM schema_migrations WHERE version = :version"),
            {"version": migration_version},
        ).first()

    # NOTE: we deliberately do NOT return early here.
    #
    # The additive column pass below is fully idempotent (it skips any column that
    # already exists), and it is the pass that prevents 500s on every Driver/User query.
    # Previously a recorded version short-circuited the whole function, so appending an
    # entry to `migrations` without also bumping the version constant was a SILENT no-op
    # on every existing database. Always scanning costs one inspector round-trip at boot
    # and removes that entire failure mode.
    #
    # `already_applied` is still used to skip the expensive duplicate-detection and index
    # creation further down, which is where the real cost is.

    migrations = [
        # User new columns
        ("users", "rating", f"{FLT} DEFAULT 5.0"),
        ("users", "rating_count", "INTEGER DEFAULT 0"),
        ("users", "push_token", "VARCHAR(200)"),
        ("users", "referral_code", "VARCHAR(20)"),
        ("users", "referred_by_user_id", "INTEGER"),
        ("users", "referral_count", "INTEGER DEFAULT 0"),
        ("users", "referral_bonus_earned", "INTEGER DEFAULT 0"),
        ("users", "referral_reward_given", BOOL_FALSE),
        ("users", "loyalty_points", "INTEGER DEFAULT 0"),
        ("users", "loyalty_lifetime_rides", "INTEGER DEFAULT 0"),
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
        ("drivers", "first_payment_bonus_granted", BOOL_FALSE),
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
        ("orders", "use_bonus", BOOL_FALSE),
        ("orders", "bonus_used", "INTEGER DEFAULT 0"),
        ("orders", "rewards_applied", BOOL_FALSE),
        ("orders", "promo_code", "VARCHAR(30)"),
        ("orders", "promo_discount", "INTEGER DEFAULT 0"),
        # OTP codes are now scoped to the flow that issued them.
        ("otp_codes", "purpose", "VARCHAR(20) DEFAULT 'passenger'"),
        # One-time code the bot sends after contact sharing (app login).
        ("telegram_auth_sessions", "login_code", "VARCHAR(10)"),
        ("telegram_auth_sessions", "code_attempts", "INTEGER DEFAULT 0"),
        # Payment provider isolation / duplicate-receipt protection
        ("payments", "provider", "VARCHAR(20) DEFAULT 'manual_app'"),
        ("payments", "provider_transaction_id", "VARCHAR(100)"),
        ("payments", "receipt_sha256", "VARCHAR(64)"),
        # Bonus ledger idempotency
        ("bonus_transactions", "idempotency_key", "VARCHAR(120)"),
        # Expo push receipt id. A ticket only means Expo ACCEPTED the message; whether FCM
        # delivered it is a separate lookup keyed by this id, and without storing it the
        # log could never tell "sent" from "actually arrived".
        ("notification_log", "ticket_id", "VARCHAR(80)"),
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
    failed = False
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
                failed = True
                print(f"  ⚠️  Skipping {table}.{column}: {e}")

    # Constraints added to ORM models only affect fresh databases. Create equivalent
    # unique indexes for existing SQLite/Postgres deployments after columns exist.
    index_statements = [
        (
            "uq_payment_provider_transaction",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_transaction "
            "ON payments (provider, provider_transaction_id)",
        ),
        (
            "uq_payment_receipt_sha256",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_receipt_sha256 "
            "ON payments (receipt_sha256)",
        ),
        (
            "uq_bonus_transactions_idempotency",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_transactions_idempotency "
            "ON bonus_transactions (idempotency_key)",
        ),
        (
            "uq_rating_order_rater_type",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_order_rater_type "
            "ON ratings (order_id, rater_type)",
        ),
        (
            "uq_order_history_action",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_history_action "
            "ON order_history (order_id, action)",
        ),
    ]
    duplicate_queries = {
        "uq_payment_provider_transaction": (
            "SELECT COUNT(*) FROM (SELECT provider, provider_transaction_id FROM payments "
            "WHERE provider_transaction_id IS NOT NULL GROUP BY provider, provider_transaction_id "
            "HAVING COUNT(*) > 1) AS duplicates"
        ),
        "uq_payment_receipt_sha256": (
            "SELECT COUNT(*) FROM (SELECT receipt_sha256 FROM payments "
            "WHERE receipt_sha256 IS NOT NULL GROUP BY receipt_sha256 "
            "HAVING COUNT(*) > 1) AS duplicates"
        ),
        "uq_bonus_transactions_idempotency": (
            "SELECT COUNT(*) FROM (SELECT idempotency_key FROM bonus_transactions "
            "WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key "
            "HAVING COUNT(*) > 1) AS duplicates"
        ),
        "uq_rating_order_rater_type": (
            "SELECT COUNT(*) FROM (SELECT order_id, rater_type FROM ratings "
            "WHERE order_id IS NOT NULL AND rater_type IS NOT NULL "
            "GROUP BY order_id, rater_type HAVING COUNT(*) > 1) AS duplicates"
        ),
        "uq_order_history_action": (
            "SELECT COUNT(*) FROM (SELECT order_id, action FROM order_history "
            "WHERE order_id IS NOT NULL AND action IS NOT NULL "
            "GROUP BY order_id, action HAVING COUNT(*) > 1) AS duplicates"
        ),
    }
    index_tables = {
        "payments", "bonus_transactions", "ratings", "order_history"
    }
    # Skip the duplicate scans + index creation once this revision is recorded: those are
    # the expensive part, and unlike the column pass they cannot silently leave the schema
    # broken (a failure sets `failed` and the version is simply not recorded).
    if not already_applied and index_tables.intersection(table_names):
        with engine.connect() as conn:
            for name, statement in index_statements:
                target_table = {
                    "uq_payment_provider_transaction": "payments",
                    "uq_payment_receipt_sha256": "payments",
                    "uq_bonus_transactions_idempotency": "bonus_transactions",
                    "uq_rating_order_rater_type": "ratings",
                    "uq_order_history_action": "order_history",
                }[name]
                if target_table not in table_names:
                    continue
                try:
                    duplicate_groups = conn.execute(
                        text(duplicate_queries[name])
                    ).scalar_one()
                    if duplicate_groups:
                        failed = True
                        print(
                            f"  ⚠️  Cannot create {name}: {duplicate_groups} duplicate "
                            "key group(s) require operator remediation"
                        )
                        conn.rollback()
                        continue
                    conn.execute(text(statement))
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    failed = True
                    print(f"  ⚠️  Skipping index {name}: {e}")

    if not failed:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO schema_migrations (version, name, applied_at) "
                    "VALUES (:version, :name, :applied_at) ON CONFLICT (version) DO NOTHING"
                ),
                {
                    "version": migration_version,
                    "name": migration_name,
                    "applied_at": datetime.utcnow(),
                },
            )

    return count


def _backfill_commission_charged():
    """Stop the deferred-commission scheduler from retroactively debiting old rides.

    `orders.commission_charged` is added to existing deployments with DEFAULT FALSE. That
    makes EVERY order ever accepted match the scheduler's "window elapsed and still owes
    commission" query, so on the first poll after deploy it would debit a driver's LIVE
    balance once per historical ride — hundreds of thousands of so'm, pushing the whole
    fleet under the minimum balance and blocking them from taking work.

    Those rides pre-date deferred commission (they were charged at accept time, or not at
    all), so settle them once. Only orders already PAST the charge cutoff are closed:
    anything accepted inside the current window is a genuinely pending charge and is left
    for the scheduler to collect normally.
    """
    try:
        with DbContext() as session:
            if session.query(Setting).filter_by(
                key="commission_charged_backfill_done"
            ).first():
                return
            cutoff = datetime.utcnow() - timedelta(
                minutes=config.COMMISSION_WINDOW_MINUTES
            )
            settled = session.query(Order).filter(
                Order.commission_charged == False,  # noqa: E712
                Order.accepted_at != None,  # noqa: E711
                Order.accepted_at <= cutoff,
            ).update({Order.commission_charged: True}, synchronize_session=False)
            session.add(Setting(key="commission_charged_backfill_done", value="1"))
            print(f"  ✓ Settled {settled} pre-deferred-commission order(s)")
    except Exception as e:
        print(f"  ⚠️  commission_charged backfill skipped: {e}")


def _grandfather_existing_drivers():
    """Trust the pre-gate fleet once, without approving drivers registered later.

    Older deployments allowed existing drivers to work before document approval became
    mandatory. Preserve that installed fleet explicitly, then persist independent flags
    so later registrations must submit documents and receive administrator approval.

    The two backfills MUST NOT be chained. Setting `documents_submitted=True` fleet-wide
    and then selecting `documents_submitted == True` in the same transaction matches every
    row the first statement just touched, so the verification pass handed `is_verified`
    to drivers an administrator had never reviewed — unvetted people carrying passengers.
    The cohort is therefore captured BEFORE the docs pass, and the verification pass is
    driven by that snapshot instead of by the flag it just wrote.
    """
    try:
        with DbContext() as session:
            docs_flag = session.query(Setting).filter_by(key="docs_backfill_done").first()
            verification_flag = session.query(Setting).filter_by(
                key="verification_gate_backfill_done"
            ).first()

            # Verification runs FIRST, while `documents_submitted` still distinguishes the
            # pre-gate fleet from later registrations.
            if not verification_flag:
                query = session.query(Driver)
                if docs_flag:
                    # The docs backfill ran in an EARLIER deploy, so `documents_submitted`
                    # no longer identifies the pre-gate fleet: every driver who has since
                    # uploaded documents carries it too, approved or not. Fall back to
                    # evidence that the platform already let them work — completed rides.
                    # A pending registrant has none, and an administrator can still
                    # approve them by hand in the bot.
                    query = query.filter(
                        Driver.documents_submitted == True,  # noqa: E712
                        Driver.total_orders > 0,
                    )
                # Otherwise every row present right now predates the gate by definition,
                # so the unfiltered update is the intended "trust the installed fleet".
                approved = query.update(
                    {Driver.is_verified: True}, synchronize_session=False
                )
                session.add(Setting(key="verification_gate_backfill_done", value="1"))
                session.flush()
                print(f"  ✓ Trusted {approved} pre-gate drivers (is_verified=True)")

            if not docs_flag:
                session.query(Driver).update(
                    {Driver.documents_submitted: True}, synchronize_session=False
                )
                session.add(Setting(key="docs_backfill_done", value="1"))
                print("  ✓ Grandfathered existing drivers (documents_submitted=True)")
    except Exception as e:
        print(f"  ⚠️  driver gate backfill skipped: {e}")


def _backfill_first_payment_bonus_flags():
    """Migrate the legacy first-payers JSON list into an atomic Driver flag."""
    try:
        with DbContext() as session:
            row = session.query(Setting).filter_by(key="first_payers").first()
            if not row or not row.value:
                return
            try:
                telegram_ids = [int(value) for value in json.loads(row.value)]
            except (TypeError, ValueError, json.JSONDecodeError):
                return
            if telegram_ids:
                session.query(Driver).filter(
                    Driver.telegram_id.in_(telegram_ids)
                ).update(
                    {Driver.first_payment_bonus_granted: True},
                    synchronize_session=False,
                )
    except Exception as e:
        print(f"  ⚠️  first-payment bonus backfill skipped: {e}")


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

    # Existing deployments tracked first bonuses in a JSON Setting. Copy that state
    # into the new atomic per-driver flag before any new payment can be approved.
    _backfill_first_payment_bonus_flags()

    # Must run before the commission scheduler's first poll, which is why it sits here
    # (immediately after the column pass) rather than at the end with the other backfills.
    _backfill_commission_charged()

    # Seed routes (isolated so a failure here can't skip later steps).
    try:
        with DbContext() as session:
            counts["routes"] = seed_routes(session)
    except Exception as e:
        print(f"⚠️  seed_routes skipped: {e}")

    if not os.path.exists(json_path):
        # Try local path as fallback
        local_path = "./data/taksi_baza.json"
        if os.path.exists(local_path):
            json_path = local_path
        else:
            print(f"⚠️  Legacy JSON not found at {json_path}, skipping JSON migration")
            _grandfather_existing_drivers()
            return counts

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Failed to read JSON: {e}")
        _grandfather_existing_drivers()
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

    # Run only after legacy import so that the pre-gate cohort includes imported
    # drivers, while the persisted flags prevent future registrations being trusted.
    _backfill_first_payment_bonus_flags()
    _grandfather_existing_drivers()
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
