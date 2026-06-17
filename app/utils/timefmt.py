"""Datetime serialization helpers."""
from datetime import datetime, timezone
from typing import Optional


def iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Serialize a stored (naive) UTC datetime as an explicit UTC ISO-8601 string.

    Every timestamp in the DB is stored as naive UTC (Column default is
    datetime.utcnow). Serializing one with a bare ``.isoformat()`` omits the
    timezone, so JS clients (``new Date(...)``) interpret the value as LOCAL
    time. In Uzbekistan (UTC+5) that makes a brand-new record look ~5 hours old
    (e.g. an order shows as "5 soat oldin" the instant it is created).

    Tagging the value with an explicit UTC offset (``+00:00``) makes every
    client parse the correct instant regardless of the device timezone.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
