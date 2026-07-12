"""Optional error monitoring via Sentry.

Completely inert unless SENTRY_DSN is configured, so it is safe to call in every
environment. When a DSN is set, unhandled errors in the API and Telegram bot are
reported to Sentry for real-time visibility (crashes, 500s, exceptions).
"""
import logging

from app import config

logger = logging.getLogger(__name__)

_initialized = False


def init_sentry() -> bool:
    """Initialize Sentry if SENTRY_DSN is configured. Returns True when active."""
    global _initialized
    if _initialized:
        return True

    dsn = config.SENTRY_DSN
    if not dsn:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.aiohttp import AioHttpIntegration
    except ImportError:
        logger.warning(
            "SENTRY_DSN is set but sentry-sdk is not installed; monitoring disabled. "
            "Add sentry-sdk to requirements.txt."
        )
        return False

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=config.SENTRY_ENVIRONMENT,
            traces_sample_rate=config.SENTRY_TRACES_SAMPLE_RATE,
            integrations=[AioHttpIntegration()],
            # Do not attach request bodies / user PII by default (privacy).
            send_default_pii=False,
        )
        _initialized = True
        logger.info(
            "✅ Sentry monitoring initialized (environment=%s)",
            config.SENTRY_ENVIRONMENT,
        )
        return True
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Failed to initialize Sentry: %s", e)
        return False


def capture_exception(exc: BaseException) -> None:
    """Report an exception to Sentry. No-op if Sentry is not initialized."""
    if not _initialized:
        return
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except Exception:  # pragma: no cover - never let monitoring break the request
        pass
