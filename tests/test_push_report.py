"""Accounting for the admin push broadcast (app/services/push_report.py).

The bug these cover: the admin panel reported "0 ta xabar yuborildi" as a green success,
so a broadcast that reached nobody was indistinguishable from one that worked.
"""
from app.services.push_report import (
    pending_telegram_keys,
    reached_by_push,
    summarize_broadcast,
)

EMPTY_TG = {"sent": 0, "failed": 0, "errors": {}, "sent_ids": []}


def _push(sent=0, failed=0, errors=None, failed_recipients=()):
    return {
        "total": sent + failed,
        "sent": sent,
        "failed": failed,
        "errors": errors or {},
        "failed_recipients": list(failed_recipients),
    }


# ---------- reached_by_push ----------

def test_reached_by_push_excludes_expo_failures():
    keys = [("driver", 1), ("driver", 2), ("user", 3)]
    stats = _push(sent=2, failed=1, failed_recipients=[("driver", 2)])
    assert reached_by_push(keys, stats) == {("driver", 1), ("user", 3)}


def test_reached_by_push_handles_list_shaped_failures():
    # send_push_bulk_stats stores tuples, but JSON round-trips them as lists.
    stats = _push(sent=0, failed=1, failed_recipients=[["driver", 1]])
    assert reached_by_push([("driver", 1)], stats) == set()


# ---------- pending_telegram_keys ----------

def test_pending_skips_already_pushed_and_tokenless_without_chat():
    all_keys = [("driver", 1), ("driver", 2), ("user", 3), ("user", 4)]
    telegram_of = {("driver", 2): 222, ("user", 3): 333}  # user 4 has no chat at all
    pending = pending_telegram_keys(all_keys, {("driver", 1)}, telegram_of)
    assert pending == [("driver", 2), ("user", 3)]


def test_pending_includes_recipients_whose_push_failed():
    # A driver with a token that Expo rejected must still get the message somehow.
    all_keys = [("driver", 1)]
    telegram_of = {("driver", 1): 111}
    stats = _push(sent=0, failed=1, failed_recipients=[("driver", 1)])
    reached = reached_by_push([("driver", 1)], stats)
    assert pending_telegram_keys(all_keys, reached, telegram_of) == [("driver", 1)]


def test_pending_preserves_order_and_deduplicates():
    all_keys = [("user", 9), ("driver", 1), ("user", 9)]
    telegram_of = {("user", 9): 99, ("driver", 1): 11}
    assert pending_telegram_keys(all_keys, set(), telegram_of) == [("user", 9), ("driver", 1)]


# ---------- summarize_broadcast ----------

def test_nobody_reached_is_reported_as_a_failure_not_a_success():
    # The original bug: 5 recipients, no push tokens, nothing sent.
    all_keys = [("driver", i) for i in range(1, 6)]
    r = summarize_broadcast(
        all_keys, set(), {}, EMPTY_TG,
        token_count=0, telegram_attempted=0, no_route=5, push_stats=_push(),
    )
    assert r["level"] == "danger"
    assert "Hech kimga darhol yuborilmadi" in r["detail"]
    assert r["total_sent"] == 0
    assert r["stats"]["unreached"] == 5
    assert {"error": "Push token ham, Telegram ham yo'q", "count": 5} in r["stats"]["errors"]


# ---------- the in-app inbox changes the verdict ----------

def test_inbox_downgrades_total_send_failure_to_a_warning():
    # Nothing went out live, but the announcement is stored, so the message is late —
    # not lost. Reporting it as a hard failure would be wrong.
    all_keys = [("driver", i) for i in range(1, 6)]
    r = summarize_broadcast(
        all_keys, set(), {}, EMPTY_TG,
        token_count=0, telegram_attempted=0, no_route=5, push_stats=_push(),
        inbox_saved=True,
    )
    assert r["level"] == "warning"
    assert "ilovada hammaga ko'rinadi" in r["detail"]
    assert r["stats"]["inbox_saved"] is True


def test_inbox_note_is_omitted_when_there_are_no_recipients():
    r = summarize_broadcast(
        [], set(), {}, EMPTY_TG,
        token_count=0, telegram_attempted=0, inbox_saved=True,
    )
    assert r["detail"] == "Qabul qiluvchi topilmadi"


def test_inbox_flag_defaults_to_false():
    r = summarize_broadcast(
        [("driver", 1)], {("driver", 1)}, {}, EMPTY_TG,
        token_count=1, telegram_attempted=0, push_stats=_push(sent=1),
    )
    assert r["stats"]["inbox_saved"] is False
    assert "ilovada" not in r["detail"]


def test_no_recipients_at_all_is_a_warning():
    r = summarize_broadcast([], set(), {}, EMPTY_TG, token_count=0, telegram_attempted=0)
    assert r["level"] == "warning"
    assert r["detail"] == "Qabul qiluvchi topilmadi"


def test_telegram_fallback_reaches_everyone_and_reports_success():
    all_keys = [("driver", 1), ("driver", 2), ("driver", 3)]
    telegram_of = {("driver", 1): 11, ("driver", 2): 22, ("driver", 3): 33}
    tg = {"sent": 3, "failed": 0, "errors": {}, "sent_ids": [11, 22, 33]}
    r = summarize_broadcast(
        all_keys, set(), telegram_of, tg,
        token_count=0, telegram_attempted=3, push_stats=_push(),
    )
    assert r["level"] == "success"
    assert r["total_sent"] == 3
    assert r["stats"]["unreached"] == 0
    assert "Telegram: 3" in r["detail"]


def test_mixed_push_and_telegram_counts_each_person_once():
    # driver 1 got a push; drivers 2 and 3 had no token and got Telegram.
    all_keys = [("driver", 1), ("driver", 2), ("driver", 3)]
    telegram_of = {("driver", 2): 22, ("driver", 3): 33}
    tg = {"sent": 2, "failed": 0, "errors": {}, "sent_ids": [22, 33]}
    r = summarize_broadcast(
        all_keys, {("driver", 1)}, telegram_of, tg,
        token_count=1, telegram_attempted=2, push_stats=_push(sent=1),
    )
    assert r["total_sent"] == 3
    assert r["stats"]["unreached"] == 0
    assert r["level"] == "success"
    assert "push: 1" in r["detail"] and "Telegram: 2" in r["detail"]


def test_one_person_registered_twice_shares_a_chat_without_phantom_unreached():
    # Same human is both driver #1 and passenger #7 with one Telegram chat. Telegram sends
    # ONE message; both rows must count as reached, otherwise the panel invents a failure.
    all_keys = [("driver", 1), ("user", 7)]
    telegram_of = {("driver", 1): 500, ("user", 7): 500}
    tg = {"sent": 1, "failed": 0, "errors": {}, "sent_ids": [500]}
    r = summarize_broadcast(
        all_keys, set(), telegram_of, tg,
        token_count=0, telegram_attempted=1, push_stats=_push(),
    )
    assert r["stats"]["unreached"] == 0
    assert r["level"] == "success"


def test_partial_delivery_is_a_warning_and_lists_reasons():
    all_keys = [("driver", 1), ("driver", 2)]
    telegram_of = {("driver", 1): 11, ("driver", 2): 22}
    tg = {
        "sent": 1, "failed": 1,
        "errors": {"Bot bloklangan / start bosilmagan": 1},
        "sent_ids": [11],
    }
    r = summarize_broadcast(
        all_keys, set(), telegram_of, tg,
        token_count=0, telegram_attempted=2, push_stats=_push(),
    )
    assert r["level"] == "warning"
    assert r["stats"]["unreached"] == 1
    assert "1 ta darhol yetib bormadi" in r["detail"]
    assert r["stats"]["errors"] == [
        {"error": "Telegram — Bot bloklangan / start bosilmagan", "count": 1}
    ]


def test_expo_rejection_reason_is_surfaced():
    # Tokens existed but Expo refused them all (e.g. MismatchSenderId): the operator needs
    # the reason, not just a zero.
    all_keys = [("driver", 1), ("driver", 2)]
    push = _push(failed=2, errors={"MismatchSenderId": 2},
                 failed_recipients=[("driver", 1), ("driver", 2)])
    r = summarize_broadcast(
        all_keys, reached_by_push(all_keys, push), {}, EMPTY_TG,
        token_count=2, telegram_attempted=0, push_stats=push,
    )
    assert r["level"] == "danger"
    assert r["stats"]["errors"] == [{"error": "Push — MismatchSenderId", "count": 2}]


def test_queued_background_fanout_is_not_counted_as_lost():
    all_keys = [("driver", i) for i in range(1, 401)]
    telegram_of = {("driver", i): 1000 + i for i in range(1, 401)}
    r = summarize_broadcast(
        all_keys, set(), telegram_of, EMPTY_TG,
        token_count=0, telegram_attempted=400, queued=400, push_stats=_push(),
    )
    assert r["level"] == "success"
    assert r["stats"]["unreached"] == 0
    assert r["stats"]["telegram_queued"] == 400
    assert "fonda yuborilmoqda" in r["detail"]


def test_disabling_telegram_explains_why_tokenless_people_got_nothing():
    all_keys = [("driver", 1), ("driver", 2)]
    r = summarize_broadcast(
        all_keys, set(), {("driver", 1): 11, ("driver", 2): 22}, EMPTY_TG,
        token_count=0, telegram_attempted=0, use_telegram=False, push_stats=_push(),
    )
    assert r["level"] == "danger"
    assert {"error": "Push token yo'q (Telegram o'chirilgan)", "count": 2} in r["stats"]["errors"]


def test_stats_block_is_complete_for_the_ui():
    r = summarize_broadcast(
        [("driver", 1)], {("driver", 1)}, {}, EMPTY_TG,
        token_count=1, telegram_attempted=0, push_stats=_push(sent=1),
    )
    for field in ("recipients", "with_token", "push_sent", "push_failed",
                  "telegram_attempted", "telegram_sent", "telegram_failed",
                  "telegram_queued", "unreached", "inbox_saved", "errors"):
        assert field in r["stats"], field
    assert r["stats"]["recipients"] == 1
