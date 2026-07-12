"""Tests for datetime serialization (UTC tagging)."""
from datetime import datetime, timedelta, timezone

from app.utils.timefmt import iso_utc


def test_none_returns_none():
    assert iso_utc(None) is None


def test_naive_datetime_is_tagged_as_utc():
    # DB timestamps are naive UTC; iso_utc must add an explicit +00:00 offset so JS
    # clients don't misread them as local time.
    dt = datetime(2026, 1, 1, 12, 0, 0)
    result = iso_utc(dt)
    assert result.endswith("+00:00")
    assert result.startswith("2026-01-01T12:00:00")


def test_aware_datetime_offset_is_preserved():
    dt = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone(timedelta(hours=5)))
    result = iso_utc(dt)
    assert result.endswith("+05:00")
