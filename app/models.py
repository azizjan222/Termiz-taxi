"""SQLAlchemy database models for Sarix Go."""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Float, Boolean,
    DateTime, ForeignKey, Text, Index
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ============= USERS =============
class User(Base):
    """Passengers (mobile app users)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)
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
    theme = Column(String(20), default="auto")  # auto, light, dark
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="passenger", foreign_keys="Order.passenger_id")
    addresses = relationship("SavedAddress", back_populates="user", cascade="all, delete-orphan")


# ============= DRIVERS =============
class Driver(Base):
    """Taxi drivers (registered via Telegram bot)."""
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False, index=True)
    phone = Column(String(20), unique=True, nullable=False)
    first_name = Column(String(100))
    last_name = Column(String(100))
    car_model = Column(String(100))
    car_number = Column(String(20))
    car_color = Column(String(50))
    car_photo_url = Column(String(500))  # uploaded photo path
    license_photo_url = Column(String(500))
    is_verified = Column(Boolean, default=False)  # admin approved documents
    balance = Column(Integer, default=0)
    is_blocked = Column(Boolean, default=False)
    is_online = Column(Boolean, default=False)
    rating = Column(Float, default=5.0)
    rating_count = Column(Integer, default=0)
    total_orders = Column(Integer, default=0)
    push_token = Column(String(200))  # Expo push token
    theme = Column(String(20), default="auto")
    # Free/paid subscription: while subscription_until > now, the driver pays NO
    # commission and does not need the minimum balance to accept orders.
    subscription_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="driver", foreign_keys="Order.driver_id")


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


# ============= OTP =============
class OtpCode(Base):
    """OTP verification codes."""
    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(20), nullable=False, index=True)
    code = Column(String(10), nullable=False)
    is_used = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)


# ============= PAYMENTS =============
class Payment(Base):
    """Driver balance top-up records."""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"))
    amount = Column(Integer, nullable=False)
    bonus_amount = Column(Integer, default=0)
    photo_file_id = Column(String(200))  # Telegram file_id
    status = Column(String(20), default="pending")  # pending, approved, rejected
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime)


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


# ============= SETTINGS =============
class Setting(Base):
    """Key-value settings (maintenance_mode, etc.)."""
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


# ============= RATINGS =============
class Rating(Base):
    """Ratings between drivers and passengers."""
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    rater_type = Column(String(20))  # 'passenger' or 'driver'
    rater_id = Column(Integer)
    rated_type = Column(String(20))  # 'passenger' or 'driver'
    rated_id = Column(Integer)
    stars = Column(Integer)  # 1-5
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    status = Column(String(20))  # sent, failed
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


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



# ============= TELEGRAM AUTH SESSIONS =============
class TelegramAuthSession(Base):
    """Telegram-based login/registration sessions.

    Flow:
    1. App creates a session -> gets token + bot deep link
    2. User opens bot via deep link, shares contact
    3. Bot links phone <-> telegram_id, marks session verified
    4. App polls and receives JWT once verified
    """
    __tablename__ = "telegram_auth_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    role = Column(String(20), default="passenger")  # passenger | driver
    phone = Column(String(20))            # filled from shared contact
    telegram_id = Column(BigInteger)      # filled when user opens bot
    first_name = Column(String(100))
    last_name = Column(String(100))
    status = Column(String(20), default="pending", index=True)  # pending | verified | expired
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
