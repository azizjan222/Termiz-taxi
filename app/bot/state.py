"""Bot-wide constants: conversation states and tunables pulled from config.

Kept tiny and dependency-light so every handler module can import it without cycles.
"""
from app import config as app_config

# Passenger order conversation states.
ASK_NAME, ASK_PHONE, ASK_FROM, ASK_TO, ASK_PERSON_COUNT, ASK_TIME = range(6)

# Driver registration conversation states.
(
    REG_PHONE,
    REG_FIRST_NAME,
    REG_LAST_NAME,
    REG_PINFL,
    REG_CAR_NUMBER,
    REG_CAR_MODEL,
    REG_CAR_YEAR,
) = range(100, 107)

# Timers (minutes).
WAIT_MINUTES = app_config.WAIT_MINUTES
WARN_MINUTES = app_config.WARN_MINUTES

# Frequently used config values.
ADMIN_ID = app_config.ADMIN_ID
DRIVERS_GROUP_ID = app_config.DRIVERS_GROUP_ID
BOT_TOKEN = app_config.BOT_TOKEN
