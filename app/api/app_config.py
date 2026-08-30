"""App configuration endpoint - version checking, feature flags."""
from aiohttp import web

from app import config
from app.services.dynamic_settings import get_min_driver_balance, is_apps_maintenance


async def get_app_config(request: web.Request) -> web.Response:
    """GET /api/config?app=passenger|driver
    Returns minimum required version and feature flags.
    Used by mobile apps to check if force update needed.
    """
    app_type = request.query.get("app", "passenger")

    if app_type == "driver":
        min_version = config._get("DRIVER_MIN_VERSION", "1.0.0")
        latest_version = config._get("DRIVER_LATEST_VERSION", "1.0.0")
        play_url = "https://play.google.com/store/apps/details?id=uz.sarixgo.driver"
    else:
        min_version = config._get("PASSENGER_MIN_VERSION", "1.0.0")
        latest_version = config._get("PASSENGER_LATEST_VERSION", "1.0.0")
        play_url = "https://play.google.com/store/apps/details?id=uz.sarixgo.passenger"

    return web.json_response({
        "min_version": min_version,
        "latest_version": latest_version,
        "play_url": play_url,
        "force_update": False,  # set to True when min_version > app version
        # Read from the DB, not hardcoded.
        #
        # This was `False` literal, which made the admin panel's maintenance checkbox a lie as
        # far as the apps were concerned: it paused the Telegram bot while both apps carried on
        # taking orders, and nothing surfaced the discrepancy. The panel now has a separate
        # switch per surface, and this is the apps one.
        "maintenance_mode": is_apps_maintenance(),
        "features": {
            "click_payment": bool(config.CLICK_MERCHANT_ID),
            "payme_payment": bool(config.PAYME_MERCHANT_ID),
            "ai_assistant": bool(config.OPENAI_API_KEY) or True,  # Always available (FAQ fallback)
            "push_notifications": True,
        },
        "support_telegram": config.SUPPORT_TELEGRAM,
        "support_email": config.SUPPORT_EMAIL,
        "bot_username": "termizsariosiyotaxi_bot",
        "min_driver_balance": get_min_driver_balance(),
    })
