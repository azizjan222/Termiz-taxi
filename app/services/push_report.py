"""Accounting for an admin broadcast's outcome.

Pure functions, no I/O: the counting is subtle enough to be worth testing on its own.
A single person can appear twice in one broadcast (registered both as a driver and as a
passenger, sharing one Telegram chat), a recipient can be served by push OR by Telegram,
and a large Telegram fan-out finishes after the response is returned. Counting messages
instead of people therefore produced a phantom "nobody got it" line.

A "key" below is a ``(recipient_type, recipient_id)`` tuple.
"""
from collections import Counter


def reached_by_push(push_keys, push_stats) -> set:
    """Keys that Expo accepted a message for."""
    failed = {tuple(k) for k in (push_stats.get("failed_recipients") or [])}
    return {tuple(k) for k in push_keys} - failed


def pending_telegram_keys(all_keys, reached, telegram_of) -> list:
    """Keys push could not serve and which have a Telegram chat to fall back to.

    Order follows `all_keys` so the fan-out is deterministic.
    """
    seen = set()
    out = []
    for key in all_keys:
        key = tuple(key)
        if key in reached or key in seen or key not in telegram_of:
            continue
        seen.add(key)
        out.append(key)
    return out


def summarize_broadcast(
    all_keys,
    reached,
    telegram_of,
    telegram_stats,
    *,
    token_count,
    telegram_attempted,
    queued=0,
    use_telegram=True,
    no_route=0,
    push_stats=None,
) -> dict:
    """Build the ``{level, detail, stats}`` payload the admin panel renders.

    `reached` is the set of keys push served; Telegram deliveries are added here by
    matching chat ids back to keys, so one chat shared by two rows counts for both.
    """
    push_stats = push_stats or {}
    all_keys = [tuple(k) for k in all_keys]
    reached = set(reached)

    delivered_chats = set(telegram_stats.get("sent_ids") or [])
    for key, chat_id in telegram_of.items():
        if chat_id in delivered_chats:
            reached.add(tuple(key))

    push_sent = int(push_stats.get("sent") or 0)
    tg_sent = int(telegram_stats.get("sent") or 0)
    total_sent = push_sent + tg_sent
    total = len(all_keys)
    # Queued recipients are still on their way — don't report them as lost.
    unreached = max(0, total - len(reached & set(all_keys)) - queued)

    errors = Counter()
    for reason, n in (push_stats.get("errors") or {}).items():
        errors[f"Push — {reason}"] += n
    for reason, n in (telegram_stats.get("errors") or {}).items():
        errors[f"Telegram — {reason}"] += n
    tokenless = total - token_count
    if not use_telegram and tokenless > 0:
        errors["Push token yo'q (Telegram o'chirilgan)"] += tokenless
    if no_route:
        errors["Push token ham, Telegram ham yo'q"] += no_route

    if total == 0:
        level, detail = "warning", "Qabul qiluvchi topilmadi"
    elif total_sent == 0 and queued == 0:
        level = "danger"
        detail = f"Hech kimga yuborilmadi ({total} ta qabul qiluvchidan)"
    else:
        level = "success" if unreached == 0 else "warning"
        breakdown = []
        if push_sent:
            breakdown.append(f"push: {push_sent}")
        if tg_sent:
            breakdown.append(f"Telegram: {tg_sent}")
        detail = f"{total_sent} ta xabar yuborildi"
        if breakdown:
            detail += f" ({', '.join(breakdown)})"
        if queued:
            detail += (f" · {queued} ta Telegram xabari fonda yuborilmoqda "
                       "(natijasi «Push jurnali» sahifasida)")
        if unreached:
            detail += f" · {unreached} ta yetib bormadi"

    return {
        "level": level,
        "detail": detail,
        "total_sent": total_sent,
        "unreached": unreached,
        "stats": {
            "recipients": total,
            "with_token": token_count,
            "push_sent": push_sent,
            "push_failed": int(push_stats.get("failed") or 0),
            "telegram_attempted": telegram_attempted,
            "telegram_sent": tg_sent,
            "telegram_failed": int(telegram_stats.get("failed") or 0),
            "telegram_queued": queued,
            "unreached": unreached,
            "errors": [{"error": e, "count": n} for e, n in errors.most_common(10)],
        },
    }
