"""Optional error monitoring (Sentry).

Completely opt-in and fail-safe:
- If ``SENTRY_DSN`` is empty -> no-op (the app behaves exactly as before).
- If the ``sentry-sdk`` package is not installed -> no-op (a warning is logged once).

This lets you turn on crash/error reporting in production by just setting one
environment variable, without changing any code or risking startup if the dependency
is missing.
"""
import logging

from app import config

logger = logging.getLogger("sarixgo.monitoring")


def init_sentry() -> bool:
    """Initialise Sentry if configured. Returns True when monitoring is active.

    Safe to call unconditionally at startup: never raises.
    """
    dsn = (config.SENTRY_DSN or "").strip()
    if not dsn:
        return False

    try:
        import sentry_sdk
    except ImportError:
        logger.warning(
            "SENTRY_DSN is set but the 'sentry-sdk' package is not installed; "
            "error monitoring is disabled. Add sentry-sdk to requirements to enable it."
        )
        return False

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=config.ENVIRONMENT,
            # Light performance sampling; raise for more detailed tracing if needed.
            traces_sample_rate=0.1,
            # Do NOT attach personal data (phones, names) to events by default.
            send_default_pii=False,
        )
        logger.info("✅ Sentry error monitoring initialised (env=%s)", config.ENVIRONMENT)
        return True
    except Exception as e:  # pragma: no cover - defensive
        logger.error("Sentry init failed: %s", e)
        return False
