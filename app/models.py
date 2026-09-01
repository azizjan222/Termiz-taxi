"""SQLAlchemy database models for Sarix Go."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ============= USERS =============
class User(Base):
    """Passengers (mobile app users)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)
    # Identity phone above (from OTP / Telegram contact). contact_phone is the number
    # the user TYPES in the app profile and the one shown to the other party on orders.
    contact_phone = Column(String(20), nullable=True)
    telegram_id = Column(BigInteger, unique=True, nullable=True, index=True)
    first_name = Column(String(100))
    last_name = Column(String(100))
    language = Column(String(10), default="uz")  # uz, uz-cyrl, ru, en
    is_blocked = Column(Boolean, default=False)
    bonus_balance = Column(Integer, default=0)  # ball
    rating = Column(Float, default=5.0)  # passenger rating from drivers
    rating_count = Column(Integer, default=0)
    push_token = Column(String(200))  # Expo push token
    referral_code = Column(String(20), unique=True, index=True)  # my own code
    referred_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    referral_count = Column(Integer, default=0)
    referral_bonus_earned = Column(Integer, default=0)
    # True once the referrer has been rewarded for THIS user's first completed ride, so a
    # single invited passenger can never pay their referrer more than once (fraud guard).
    referral_reward_given = Column(Boolean, default=False)
    # ===== Loyalty program (points -> bonus) =====
    # loyalty_points accumulates per COMPLETED ride and converts into spendable bonus once
    # it crosses the threshold, then resets by that threshold. loyalty_lifetime_rides is a
    # never-reset counter of completed rides (drives the "new user first N rides" referral
    # bonus and future loyalty tiers).
    loyalty_points = Column(Integer, default=0)
    loyalty_lifetime_rides = Column(Integer, default=0)
    theme = Column(String(20), default="auto")  # auto, light, dark
    profile_photo_url = Column(String(500))  # uploaded passenger profile photo
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="passenger", foreign_keys="Order.passenger_id")
    addresses = relationship("SavedAddress", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("bonus_balance >= 0", name="ck_user_bonus_nonnegative"),
        CheckConstraint("loyalty_points >= 0", name="ck_user_loyalty_points_nonnegative"),
        CheckConstraint("loyalty_lifetime_rides >= 0", name="ck_user_rides_nonnegative"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_user_rating_range"),
        CheckConstraint("rating_count >= 0", name="ck_user_rating_count_nonnegative"),
    )


# ============= DRIVERS =============
class Driver(Base):
    """Taxi drivers (registered via Telegram bot)."""
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False, index=True)
    phone = Column(String(20), unique=True, nullable=False)
    # Identity phone above. contact_phone is the number the driver TYPES in the app and
    # the one shown to the passenger on orders (instead of the Telegram contact number).
    contact_phone = Column(String(20), nullable=True)
    first_name = Column(String(100))
    last_name = Column(String(100))
    car_model = Column(String(100))
    car_number = Column(String(20))
    car_color = Column(String(50))
    car_year = Column(String(10))  # manufacture year
    pinfl = Column(String(20))  # JSHSHIR (14-digit personal ID)
    car_photo_url = Column(String(500))  # uploaded photo path
    license_photo_url = Column(String(500))
    license_back_url = Column(String(500))  # driver license BACK side
    tech_passport_url = Column(String(500))  # uploaded tech-passport image (front)
    tech_passport_back_url = Column(String(500))  # tech-passport BACK side
    profile_photo_url = Column(String(500))  # driver profile photo (shown to passengers)
    seats = Column(Integer, default=4)  # how many passengers the car seats
    # Telegram file_ids of documents collected by the bot (for admin PDF export)
    license_file_id = Column(String(200))
    tech_passport_file_id = Column(String(200))
    car_photo_file_id = Column(String(200))
    documents_submitted = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False)  # admin approved documents
    # True once the 50% first-top-up bonus has been claimed. A dedicated DB column
    # makes the one-time grant atomically enforceable; JSON Setting lists cannot.
    first_payment_bonus_granted = Column(Boolean, default=False, nullable=False)
    balance = Column(Integer, default=0)
    is_blocked = Column(Boolean, default=False)
    is_online = Column(Boolean, default=False)
    rating = Column(Float, default=5.0)
    rating_count = Column(Integer, default=0)
    total_orders = Column(Integer, default=0)
    push_token = Column(String(200))  # Expo push token
    language = Column(String(10), default="uz")  # uz, uz-cyrl, ru, en (for localized push)
    theme = Column(String(20), default="auto")
    # Live location (sent by the driver app every ~10s while on an active order).
    # Broadcast to the passenger so they can see the driver moving on the map.
    current_lat = Column(Float)
    current_lon = Column(Float)
    location_updated_at = Column(DateTime)
    # Online-time tracking. `online_since` is set when the driver toggles online;
    # when they go offline (or stats are read) the elapsed time is added to
    # `online_seconds_today`. `online_day` is the YYYY-MM-DD the accumulator belongs
    # to, so it resets automatically at the start of a new day.
    online_seconds_today = Column(Integer, default=0)
    online_since = Column(DateTime)
    online_day = Column(String(10))
    # Free/paid subscription: while subscription_until > now, the driver pays NO
    # commission and does not need the minimum balance to accept orders.
    subscription_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="driver", foreign_keys="Order.driver_id")

    __table_args__ = (
        CheckConstraint("seats > 0", name="ck_driver_seats_positive"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_driver_rating_range"),
        CheckConstraint("rating_count >= 0", name="ck_driver_rating_count_nonnegative"),
        CheckConstraint("total_orders >= 0", name="ck_driver_total_orders_nonnegative"),
        # The passenger wallet has always had this; the driver wallet did not, and the
        # commission debits were unconditional (`balance = (balance or 0) - commission`).
        # Because the balance floor is only checked at ACCEPT time, a driver could hold
        # MAX_ACTIVE_NONPARCEL_ORDERS rides against one commission's worth of balance and
        # then be debited once per ride, going negative. The platform then carried
        # uncollectable debt with nothing recording that it had happened.
        #
        # Enforcing this at the DB level is only safe because every debit now goes through
        # rewards.debit_commission(), which floors the charge at the available balance and
        # books the shortfall as a `commission_debt` ledger row instead of overdrawing.
        CheckConstraint("balance >= 0", name="ck_driver_balance_nonnegative"),
    )


# ============= ROUTES =============
class Route(Base):
    """Pre-defined routes between cities/districts."""
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_city = Column(String(100), nullable=False, index=True)
    to_city = Column(String(100), nullable=False, index=True)
    price_per_person = Column(Integer, nullable=False)  # so'm
    full_car_price = Column(Integer, default=400000)
    parcel_price = Column(Integer, default=30000)
    is_active = Column(Boolean, default=True)
    distance_km = Column(Integer, default=0)
    duration_minutes = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_route_pair", "from_city", "to_city", unique=True),
        CheckConstraint("price_per_person >= 0", name="ck_route_person_price_nonnegative"),
        CheckConstraint("full_car_price >= 0", name="ck_route_full_price_nonnegative"),
        CheckConstraint("parcel_price >= 0", name="ck_route_parcel_price_nonnegative"),
    )


# ============= ORDERS =============
class Order(Base):
    """Taxi/parcel orders."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Who ordered
    passenger_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # None if from bot directly
    passenger_telegram_id = Column(BigInteger, nullable=True)  # if from bot
    passenger_phone = Column(String(20), nullable=False)
    passenger_name = Column(String(100))

    # What was ordered
    service_type = Column(String(20), default="taxi")  # taxi, parcel, full_car
    from_city = Column(String(100), nullable=False)
    to_city = Column(String(100), nullable=False)
    from_address = Column(Text)
    to_address = Column(Text)
    from_lat = Column(Float)
    from_lon = Column(Float)
    to_lat = Column(Float)
    to_lon = Column(Float)
    person_count = Column(Integer, default=1)
    price = Column(Integer, default=0)  # narx (yo'lovchi to'laydi)
    commission = Column(Integer, default=0)  # haydovchi balansidan olinadi

    # Schedule
    departure_time = Column(String(50))  # "Hozir" or "14:30" or ISO datetime

    # Parcel-specific
    parcel_recipient_name = Column(String(100))
    parcel_recipient_phone = Column(String(20))
    parcel_payer = Column(String(20))  # sender, recipient
    parcel_note = Column(Text)
    parcel_type = Column(String(50))  # hujjat, boshqa

    # Driver
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    driver_telegram_id = Column(BigInteger, nullable=True)
    # Recommendation: passenger tapped a specific recommended driver (direct notify target)
    target_driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    # ===== Bonus wallet redemption (single wallet: referral + loyalty) =====
    # use_bonus is set by the passenger app when the rider opts to spend bonus on this
    # ride. It defaults False so the feature stays DORMANT until the apps send it (no
    # bonus is ever silently consumed). bonus_used records how much bonus was actually
    # applied on completion; it is always <= the ride's commission, so the discount is
    # funded purely from forgone commission and the driver's net is never reduced.
    #
    # On a free-trial ride there is no commission to forgo, so the platform reimburses the
    # discount to the driver's balance instead (source="discount_reimbursement" in
    # BalanceTransaction). Either way the driver's net is unchanged; only the settlement
    # route differs.
    use_bonus = Column(Boolean, default=False)
    bonus_used = Column(Integer, default=0)

    # Promo code redeemed on this ride. Like bonus, the discount is funded from forgone
    # commission, so the driver's net is unchanged and the passenger pays
    # price - bonus_used - promo_discount.
    promo_code = Column(String(30))
    promo_discount = Column(Integer, default=0)
    # Commission is deducted from the driver 15 minutes after acceptance (deferred),
    # whether or not the ride is completed. This flag prevents double-charging and
    # tells cancel_order whether a refund is owed.
    commission_charged = Column(Boolean, default=False)
    # True ONLY when the commission was actually deducted from the driver's balance.
    # During the free trial the scheduler marks commission_charged=True WITHOUT deducting
    # money, so commission_collected stays False -> trial orders count as 0 commission in
    # all money reports (admin dashboard, bot /revenue) and don't confuse the stats.
    # A discount reimbursement on such an order is a separate BalanceTransaction and
    # likewise does NOT set this flag: no commission was ever collected to report.
    commission_collected = Column(Boolean, default=False)
    # Set True once the driver has been sent the "commission will be charged in N
    # minutes" heads-up, so the scheduler never warns the same order twice.
    commission_warned = Column(Boolean, default=False)
    # Durable idempotency guard for loyalty/referral grants on completion.
    rewards_applied = Column(Boolean, default=False, nullable=False)

    # Status
    status = Column(String(30), default="new", index=True)
    # statuses: new, accepted, in_progress, completed, cancelled, expired
    cancel_reason = Column(String(100))
    cancelled_by = Column(String(20))  # passenger, driver, system, admin

    # Misc
    note = Column(Text)
    has_roof_rack = Column(Boolean, default=False)
    female_only = Column(Boolean, default=False)
    male_count = Column(Integer, default=0)
    female_count = Column(Integer, default=0)
    source = Column(String(20), default="bot")  # bot, app

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    accepted_at = Column(DateTime)
    completed_at = Column(DateTime)
    cancelled_at = Column(DateTime)

    passenger = relationship("User", back_populates="orders", foreign_keys=[passenger_id])
    driver = relationship("Driver", back_populates="orders", foreign_keys=[driver_id])

    __table_args__ = (
        CheckConstraint(
            "service_type IN ('taxi', 'parcel', 'full_car')",
            name="ck_order_service_type",
        ),
        CheckConstraint(
            "status IN ('new', 'accepted', 'in_progress', 'completed', 'cancelled', 'expired')",
            name="ck_order_status",
        ),
        CheckConstraint("person_count >= 1", name="ck_order_person_count_positive"),
        CheckConstraint("price >= 0", name="ck_order_price_nonnegative"),
        CheckConstraint("commission >= 0", name="ck_order_commission_nonnegative"),
        CheckConstraint("bonus_used >= 0", name="ck_order_bonus_nonnegative"),
        CheckConstraint("bonus_used <= commission", name="ck_order_bonus_within_commission"),
        CheckConstraint("promo_discount >= 0", name="ck_order_promo_nonnegative"),
        # Bonus and promo are both funded from commission, so together they can never
        # exceed it -- otherwise the platform would pay the driver to take the ride.
        CheckConstraint(
            "bonus_used + promo_discount <= commission",
            name="ck_order_discounts_within_commission",
        ),
        CheckConstraint("male_count >= 0", name="ck_order_male_count_nonnegative"),
        CheckConstraint("female_count >= 0", name="ck_order_female_count_nonnegative"),
    )


# ============= OTP =============
class OtpCode(Base):
    """OTP verification codes."""
    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(20), nullable=False, index=True)
    code = Column(String(10), nullable=False)
    # Which login flow issued this code. Both flows used to share one credential, so a
    # code delivered to a passenger's Telegram account was accepted at the driver
    # verify endpoint (and vice versa) whenever the User and Driver rows for one phone
    # pointed at different Telegram accounts.
    purpose = Column(String(20), default="passenger")
    is_used = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "purpose IN ('passenger', 'driver')",
            name="ck_otp_purpose",
        ),
    )


# ============= PAYMENTS =============
class Payment(Base):
    """Driver balance top-up records with provider-scoped idempotency."""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False, index=True)
    provider = Column(String(20), nullable=False, default="manual_app", index=True)
    provider_transaction_id = Column(String(100), nullable=True)
    amount = Column(Integer, nullable=False)
    bonus_amount = Column(Integer, default=0, nullable=False)
    photo_file_id = Column(String(500))  # Telegram file_id or private upload path
    receipt_sha256 = Column(String(64), nullable=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    processed_at = Column(DateTime)

    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_transaction_id",
            name="uq_payment_provider_transaction",
        ),
        UniqueConstraint("receipt_sha256", name="uq_payment_receipt_sha256"),
        CheckConstraint("amount > 0", name="ck_payment_amount_positive"),
        CheckConstraint("bonus_amount >= 0", name="ck_payment_bonus_nonnegative"),
        CheckConstraint(
            "status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled')",
            name="ck_payment_status",
        ),
    )


class BalanceTransaction(Base):
    """Immutable audit ledger for every driver balance mutation.

    ``source`` values in use (all must fit VARCHAR(30)):

    * ``topup``                   — approved payment, incl. the one-time 50% bonus.
    * ``order_commission``        — deferred commission debit.
    * ``commission_debt``         — the part of a commission that could NOT be debited
      because the driver's balance was too low. Recorded so the shortfall is visible and
      collectable instead of silently overdrawing the wallet (see ck_driver_balance_nonnegative).
    * ``commission_refund``       — reversal when a passenger cancels a charged order.
    * ``discount_reimbursement``  — credit paid to a free-trial driver for a passenger's
      bonus/promo discount, where there was no commission to reduce instead.
    * ``reimbursement_reversal``  — take-back of the above when the ride is cancelled and
      the discount is returned to the passenger.
    """
    __tablename__ = "balance_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    source = Column(String(30), nullable=False, index=True)
    reference_type = Column(String(30), nullable=True)
    reference_id = Column(Integer, nullable=True)
    idempotency_key = Column(String(120), nullable=False, unique=True, index=True)
    note = Column(String(250), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        CheckConstraint("amount != 0", name="ck_balance_transaction_amount_nonzero"),
    )


# ============= SAVED ADDRESSES =============
class SavedAddress(Base):
    """User's saved addresses (home, work, etc.)."""
    __tablename__ = "saved_addresses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    label = Column(String(50))  # "Uy", "Ish"
    address = Column(Text, nullable=False)
    latitude = Column(Float)
    longitude = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="addresses")


# ============= PROMO CODES =============
class PromoCode(Base):
    """Promo codes for discounts."""
    __tablename__ = "promo_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(30), unique=True, nullable=False)
    discount_amount = Column(Integer, default=0)
    discount_percent = Column(Integer, default=0)
    max_uses = Column(Integer, default=0)  # 0 = unlimited
    used_count = Column(Integer, default=0)
    valid_until = Column(DateTime)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("max_uses >= 0", name="ck_promo_max_uses_nonnegative"),
        CheckConstraint("used_count >= 0", name="ck_promo_used_count_nonnegative"),
    )


class PromoUsage(Base):
    """One row per (promo code, passenger) redemption.

    Enforces the per-user limit at the database level. Without this table nothing tracked
    who had already redeemed a code, so ``PromoCode.used_count`` was never incremented and
    the ``max_uses`` check in the validate endpoint guarded a counter that never moved --
    a single-use code could be reused without limit.
    """
    __tablename__ = "promo_usages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    promo_code_id = Column(Integer, ForeignKey("promo_codes.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    discount_amount = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("promo_code_id", "user_id", name="uq_promo_usage_code_user"),
    )


# ============= BONUS TRANSACTIONS =============
class BonusTransaction(Base):
    """Audit ledger for every change to a passenger's bonus wallet.

    One wallet (User.bonus_balance) is shared by both programs; this ledger records WHY
    each change happened so referral vs loyalty spend can be reported and any fraudulent
    credit reversed. Positive ``amount`` = credit (earned), negative = debit (spent on a
    ride). ``balance_after`` snapshots the wallet right after the change.
    """
    __tablename__ = "bonus_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)  # + earned, - spent
    source = Column(String(20), index=True)  # referral, loyalty, redeem, promo, admin
    reason = Column(String(200))
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    idempotency_key = Column(String(120), nullable=True, unique=True, index=True)
    balance_after = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ============= SETTINGS =============
class Setting(Base):
    """Key-value settings (maintenance_mode, etc.)."""
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchemaMigration(Base):
    """Applied lightweight schema migration versions for existing deployments."""
    __tablename__ = "schema_migrations"

    version = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    applied_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AdminAuditLog(Base):
    """Append-only record of security-sensitive admin actions."""
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    admin_username = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(String(100), nullable=True)
    details = Column(Text, nullable=True)
    remote_ip = Column(String(64), nullable=True)
    user_agent = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


# ============= STATISTICS =============
class OrderHistory(Base):
    """Completed/cancelled order history for stats."""
    __tablename__ = "order_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer)
    action = Column(String(30))  # completed, cancelled
    from_city = Column(String(100))
    to_city = Column(String(100))
    person_count = Column(Integer)
    commission = Column(Integer)
    actor = Column(String(100))  # who completed/cancelled
    actor_phone = Column(String(20))
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        UniqueConstraint("order_id", "action", name="uq_order_history_action"),
        CheckConstraint("action IN ('completed', 'cancelled')", name="ck_order_history_action"),
    )


# ============= RATINGS =============
class Rating(Base):
    """Ratings between drivers and passengers."""
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    rater_type = Column(String(20), nullable=False)  # 'passenger' or 'driver'
    rater_id = Column(Integer, nullable=False)
    rated_type = Column(String(20), nullable=False)  # 'passenger' or 'driver'
    rated_id = Column(Integer, nullable=False)
    stars = Column(Integer, nullable=False)  # 1-5
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("order_id", "rater_type", name="uq_rating_order_rater_type"),
        CheckConstraint("stars >= 1 AND stars <= 5", name="ck_rating_stars"),
        CheckConstraint("rater_type IN ('passenger', 'driver')", name="ck_rating_rater_type"),
        CheckConstraint("rated_type IN ('passenger', 'driver')", name="ck_rating_rated_type"),
    )


# ============= NOTIFICATIONS LOG =============
class NotificationLog(Base):
    """Log of sent push notifications."""
    __tablename__ = "notification_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    recipient_type = Column(String(20))  # 'user' or 'driver'
    recipient_id = Column(Integer)
    title = Column(String(200))
    body = Column(Text)
    data = Column(Text)  # JSON
    status = Column(String(20))  # sent, delivered, failed
    error = Column(Text)
    # Expo receipt id from the send ticket. "sent" only means Expo accepted the message;
    # whether FCM actually delivered it is a separate lookup keyed by this id. Kept so a
    # silent delivery failure (MismatchSenderId, DeviceNotRegistered) can be seen at all.
    ticket_id = Column(String(80))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ============= ANNOUNCEMENTS (in-app inbox) =============
class Announcement(Base):
    """An admin broadcast, readable in the app by everyone in its audience.

    Push and Telegram are both fire-and-forget: a recipient with no push token, or whose
    device was off when the message went out, had no way to ever see it. Only people who
    had opened the mobile app on a real device could receive a broadcast at all, so
    "Barchaga" reached almost nobody. Persisting the broadcast lets the apps list it
    whenever they next open, which is what makes "send to everyone" true.

    Stored ONCE per broadcast, not once per recipient: a fan-out row per user would mean
    tens of thousands of rows for a single message, while the audience is expressible as
    a filter.
    """
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 'all' | 'drivers' | 'passengers' | 'user' (a single named recipient)
    audience = Column(String(20), nullable=False, default="all", index=True)
    # Only set when audience == 'user'.
    recipient_type = Column(String(20), nullable=True)  # 'user' or 'driver'
    recipient_id = Column(Integer, nullable=True)
    # Normally NULL: the title is localized to the reader's own language when served, so
    # one row serves all four languages. A stored value overrides that.
    title = Column(String(200), nullable=True)
    body = Column(Text, nullable=False)
    created_by = Column(String(100), nullable=True)  # admin username, for traceability
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        CheckConstraint(
            "audience IN ('all', 'drivers', 'passengers', 'user')",
            name="ck_announcement_audience",
        ),
        Index("ix_announcement_recipient", "recipient_type", "recipient_id"),
    )


class AnnouncementRead(Base):
    """Marks one announcement as read by one recipient.

    A row appears only once someone actually reads the message, so this table grows with
    engagement rather than with audience size. The unique constraint makes marking a
    message read idempotent, which matters because the apps re-sync on every open.
    """
    __tablename__ = "announcement_reads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    announcement_id = Column(
        Integer, ForeignKey("announcements.id"), nullable=False, index=True
    )
    recipient_type = Column(String(20), nullable=False)  # 'user' or 'driver'
    recipient_id = Column(Integer, nullable=False)
    read_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "announcement_id", "recipient_type", "recipient_id",
            name="uq_announcement_read",
        ),
        CheckConstraint(
            "recipient_type IN ('user', 'driver')",
            name="ck_announcement_read_recipient_type",
        ),
    )


# ============= SOS / EMERGENCY =============
class SosAlert(Base):
    """Emergency SOS alerts."""
    __tablename__ = "sos_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    reporter_type = Column(String(20))  # 'passenger' or 'driver'
    reporter_phone = Column(String(20))
    latitude = Column(Float)
    longitude = Column(Float)
    note = Column(Text)
    status = Column(String(20), default="open")  # open, in_progress, resolved
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at = Column(DateTime)


# ============= PENDING REFERRALS =============
class PendingReferral(Base):
    """A referral code from a bot deep link, held until the invitee signs up.

    ``t.me/<bot>?start=ref_CODE`` reaches the bot, but there is nothing to link yet: ``User``
    rows are created by the app's auth flow (``app/api/auth.py``), and somebody arriving from
    an invite link normally has no account at all. Without somewhere to park the code, the
    invite is simply lost — which is what used to happen, since the bot ignored ``ref_``
    entirely while the API happily generated links containing it.

    One row per Telegram account, overwritten by a newer link, consumed and deleted at signup
    (``app.services.referral.consume_pending``). Rows for people who never sign up are
    harmless: a code and an id, no personal data.
    """
    __tablename__ = "pending_referrals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False, index=True)
    referral_code = Column(String(20), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ============= TELEGRAM AUTH SESSIONS =============
class TelegramAuthSession(Base):
    """Telegram-based login/registration sessions.

    Flow:
    1. App creates a session -> gets token + bot deep link
    2. User opens bot via deep link, shares contact
    3. Bot links phone <-> telegram_id, marks session verified and sends a one-time code
    4. App asks the user to type that code -> POST .../telegram/verify-code -> JWT

    Step 4 is the ONLY way to redeem a session. The older polling path
    (GET .../telegram/check) minted a JWT from the token alone — i.e. for whoever
    generated the deep link rather than whoever received the bot's code — and is now a
    410. See ``app.api.auth.telegram_check``.
    """
    __tablename__ = "telegram_auth_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    role = Column(String(20), default="passenger")  # passenger | driver
    phone = Column(String(20))            # filled from shared contact
    telegram_id = Column(BigInteger)      # filled when user opens bot
    first_name = Column(String(100))
    last_name = Column(String(100))
    status = Column(String(20), default="pending", index=True)
    # pending | verified | used | expired

    # One-time code the bot sends into the user's Telegram chat once they share their
    # contact. The app then asks the user to type it. This is what makes the flow safe
    # against a phished deep link: the token lives on the requesting device, but the code
    # is delivered only to the real account's chat, so an attacker holding a token they
    # tricked someone into opening still cannot complete the login.
    login_code = Column(String(10))
    code_attempts = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)



class DriverDocumentImage(Base):
    """Fingerprint of the image currently accepted for one driver document slot.

    Exists so "is this the same picture again?" is answerable. Before it, the four document
    columns on ``drivers`` held URLs and nothing else, so four uploads of one screenshot were
    four unrelated successes — the incident this table is here to prevent.

    One row per (driver, slot): re-uploading a slot UPDATES its row rather than adding one,
    which is what keeps the unique ``sha256`` below compatible with a driver legitimately
    re-sending the identical file for the same document.

    Both hashes are kept because they fail differently. ``sha256`` is exact and cheap but
    changes completely on a re-encode — and the image picker re-encodes at ``quality: 0.7``,
    so it alone would miss the same gallery photo picked twice. ``phash`` (average hash)
    survives re-encoding, resizing and mild cropping, but is coarse enough that it is only
    trusted for near-duplicate comparison within one driver's own slots.
    """

    __tablename__ = "driver_document_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False, index=True)
    # license | license_back | tech_passport | tech_passport_back | car_photo
    kind = Column(String(30), nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    phash = Column(String(16), nullable=False, index=True)
    # Kept for the admin review screen: they explain WHY an upload was accepted and let a
    # reviewer spot a technically-valid but poor photo without opening the file.
    width = Column(Integer, nullable=False, default=0)
    height = Column(Integer, nullable=False, default=0)
    sharpness = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("driver_id", "kind", name="uq_driver_document_slot"),
        # Globally unique: the same bytes must never back two documents, whether that is one
        # driver filling two slots with one photo or two drivers sharing one. This also
        # closes the check-then-insert race, since the DB refuses the second writer.
        UniqueConstraint("sha256", name="uq_driver_document_sha256"),
        CheckConstraint(
            "kind IN ('license', 'license_back', 'tech_passport', "
            "'tech_passport_back', 'car_photo')",
            name="ck_driver_document_kind",
        ),
    )
