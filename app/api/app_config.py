"""App configuration endpoint - version checking, feature flags."""
from aiohttp import web

from app import config


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
        "maintenance_mode": False,
        "features": {
            "click_payment": bool(config.CLICK_MERCHANT_ID),
            "payme_payment": bool(config.PAYME_MERCHANT_ID),
            "ai_assistant": bool(config.OPENAI_API_KEY) or True,  # Always available (FAQ fallback)
            "push_notifications": True,
        },
        "support_telegram": config.SUPPORT_TELEGRAM,
        "bot_username": "termizsariosiyotaxi_bot",
        "min_driver_balance": config.MIN_DRIVER_BALANCE,
    })
