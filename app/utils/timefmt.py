"""Datetime serialization helpers."""
from datetime import datetime, timedelta, timezone
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



# ---------------------------------------------------------------------------
# Local (Uzbekistan) calendar helpers
# ---------------------------------------------------------------------------
# Every timestamp is STORED as naive UTC, but "today", "this month" and the daily
# report buckets are business concepts that must follow the LOCAL calendar. Computing
# them with datetime.utcnow().replace(hour=0, ...) put the day boundary at 05:00
# Tashkent time, so anything that happened between local 00:00 and 05:00 was
# attributed to the previous day: driver earnings cards, the daily chart, "online
# today" and the admin revenue totals all disagreed with what people experienced.
#
# Uzbekistan uses UTC+5 year-round with no daylight saving, so a fixed offset is
# correct and avoids a tzdata dependency.
UZ_TZ_OFFSET = timedelta(hours=5)


def local_now(now: Optional[datetime] = None) -> datetime:
    """Wall-clock time in Uzbekistan for a stored naive-UTC instant."""
    return (now or datetime.utcnow()) + UZ_TZ_OFFSET


def local_day_str(dt: Optional[datetime]) -> Optional[str]:
    """``YYYY-MM-DD`` of a stored naive-UTC timestamp, on the LOCAL calendar."""
    if dt is None:
        return None
    return (dt + UZ_TZ_OFFSET).strftime("%Y-%m-%d")


def local_day_start_utc(now: Optional[datetime] = None) -> datetime:
    """Naive-UTC instant of the most recent LOCAL midnight.

    Use this for "today" filters against stored UTC columns.
    """
    local_midnight = local_now(now).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight - UZ_TZ_OFFSET


def local_month_start_utc(now: Optional[datetime] = None) -> datetime:
    """Naive-UTC instant of LOCAL midnight on the first day of the local month."""
    local_first = local_now(now).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    return local_first - UZ_TZ_OFFSET
