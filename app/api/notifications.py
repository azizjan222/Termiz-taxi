"""Push token registration and the in-app announcement inbox."""
import logging
import re

from aiohttp import web
from sqlalchemy import and_, or_

from app.api.auth import SUPPORTED_LANGUAGES
from app.api.drivers import _get_driver_from_request
from app.database import get_session
from app.models import Announcement, AnnouncementRead, Driver, User
from app.services import notify_i18n as nt
from app.utils.body import BodyError, read_json_object, read_str
from app.utils.timefmt import iso_utc

logger = logging.getLogger(__name__)

#: Expo push tokens are always `ExponentPushToken[...]` (or the legacy `ExpoPushToken[...]`).
_EXPO_TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[^\[\]\s]+\]$")

#: Default/maximum number of announcements returned in one call. The apps keep at most
#: 100 notifications locally, so serving more than that is wasted work.
_DEFAULT_LIMIT = 50
_MAX_LIMIT = 100


async def register_token(request: web.Request) -> web.Response:
    """POST /api/notifications/register-token
    Body: {"token": "ExponentPushToken[...]"}
    Works for authenticated user (passenger) or driver.
    """
    try:
        data = await read_json_object(request)
        token = read_str(data, "token", max_length=200)
        lang = read_str(data, "language")
    except BodyError as e:
        return e.response

    if not token:
        return web.json_response({"error": "Token kerak"}, status=400)
    # Any string used to be accepted and written to push_token. A malformed value is not
    # harmless: Expo rejects the whole batch it appears in, so one bad token could stop
    # notifications for the drivers/passengers batched alongside it, and the column is
    # VARCHAR(200) so an over-long value failed at commit with a 500.
    if not _EXPO_TOKEN_RE.match(token):
        return web.json_response({"error": "Push token noto'g'ri"}, status=400)

    # Optional language so push notifications can be localized to the user's choice.
    if lang not in SUPPORTED_LANGUAGES:
        lang = None

    # Check driver auth first
    driver = _get_driver_from_request(request)
    if driver:
        session = get_session()
        try:
            d = session.query(Driver).filter_by(id=driver.id).first()
            if d:
                d.push_token = token
                if lang:
                    d.language = lang
                session.commit()
                return web.json_response({"success": True, "role": "driver"})
        finally:
            session.close()

    # Try passenger auth
    from app.utils.auth import get_current_user
    user = get_current_user(request)
    if user:
        session = get_session()
        try:
            u = session.query(User).filter_by(id=user.id).first()
            if u:
                u.push_token = token
                if lang:
                    u.language = lang
                session.commit()
                return web.json_response({"success": True, "role": "passenger"})
        finally:
            session.close()

    return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)


async def remove_token(request: web.Request) -> web.Response:
    """POST /api/notifications/remove-token
    Removes push token (e.g., on logout).
    """
    driver = _get_driver_from_request(request)
    if driver:
        session = get_session()
        try:
            d = session.query(Driver).filter_by(id=driver.id).first()
            if d:
                d.push_token = None
                session.commit()
            return web.json_response({"success": True})
        finally:
            session.close()

    from app.utils.auth import get_current_user
    user = get_current_user(request)
    if user:
        session = get_session()
        try:
            u = session.query(User).filter_by(id=user.id).first()
            if u:
                u.push_token = None
                session.commit()
            return web.json_response({"success": True})
        finally:
            session.close()

    return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)



# ============= IN-APP ANNOUNCEMENT INBOX =============
#
# Push and Telegram are fire-and-forget. A recipient without a push token, or whose phone
# was off when a broadcast went out, could never see the message afterwards — there was no
# server-side record for the app to read. These endpoints are that record, so an admin
# broadcast is visible in the app to EVERY signed-in user whenever they next open it.


def _caller(request: web.Request):
    """Resolve the authenticated caller as ``(kind, id)`` with kind 'driver' or 'user'.

    Returns ``(None, None)`` when unauthenticated. Driver auth is checked first, matching
    the order used by register_token above (the two apps use different token stores, so
    only one can ever match).
    """
    driver = _get_driver_from_request(request)
    if driver:
        return "driver", driver.id

    from app.utils.auth import get_current_user
    user = get_current_user(request)
    if user:
        return "user", user.id
    return None, None


def _audience_filter(kind: str, recipient_id: int):
    """SQL filter for announcements this recipient is allowed to see."""
    own_group = "drivers" if kind == "driver" else "passengers"
    return or_(
        Announcement.audience.in_(("all", own_group)),
        and_(
            Announcement.audience == "user",
            Announcement.recipient_type == kind,
            Announcement.recipient_id == recipient_id,
        ),
    )


def _visible_announcements(session, kind: str, recipient_id: int, joined_at, limit: int):
    """Announcements for this recipient, newest first."""
    query = session.query(Announcement).filter(_audience_filter(kind, recipient_id))
    # Don't greet a brand-new account with months of broadcasts it was never part of.
    if joined_at:
        query = query.filter(Announcement.created_at >= joined_at)
    return query.order_by(Announcement.id.desc()).limit(limit).all()


def _read_ids(session, kind: str, recipient_id: int, announcement_ids: list) -> set:
    """Which of `announcement_ids` this recipient has already read."""
    if not announcement_ids:
        return set()
    rows = (
        session.query(AnnouncementRead.announcement_id)
        .filter(
            AnnouncementRead.recipient_type == kind,
            AnnouncementRead.recipient_id == recipient_id,
            AnnouncementRead.announcement_id.in_(announcement_ids),
        )
        .all()
    )
    return {row[0] for row in rows}


async def list_notifications(request: web.Request) -> web.Response:
    """GET /api/notifications?limit=50

    Returns ``{"items": [...], "unread": N}`` — the announcements addressed to the caller,
    newest first, each flagged as read or unread.
    """
    kind, recipient_id = _caller(request)
    if not kind:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    try:
        limit = int(request.query.get("limit", _DEFAULT_LIMIT))
    except (TypeError, ValueError):
        limit = _DEFAULT_LIMIT
    limit = max(1, min(limit, _MAX_LIMIT))

    session = get_session()
    try:
        model = Driver if kind == "driver" else User
        me = session.query(model).filter_by(id=recipient_id).first()
        if not me:
            return web.json_response({"error": "Foydalanuvchi topilmadi"}, status=404)

        # One stored row serves both apps: the title is the reading app's own name
        # ("Sarix Go" / "Sarix Driver"), matching what the push itself showed.
        title = nt.app_title(kind)
        rows = _visible_announcements(session, kind, recipient_id, me.created_at, limit)
        seen = _read_ids(session, kind, recipient_id, [a.id for a in rows])

        items = [
            {
                "id": a.id,
                "title": a.title or title,
                "body": a.body,
                "type": "admin",
                "read": a.id in seen,
                # Naive-UTC column, so the offset must be explicit or the apps render
                # every fresh announcement as "5 soat oldin".
                "created_at": iso_utc(a.created_at),
            }
            for a in rows
        ]
        return web.json_response({
            "items": items,
            "unread": sum(1 for item in items if not item["read"]),
        })
    finally:
        session.close()


async def mark_notifications_read(request: web.Request) -> web.Response:
    """POST /api/notifications/read

    Body: ``{"ids": [1, 2]}`` to mark specific announcements, or ``{"all": true}`` for
    every announcement currently addressed to the caller.
    """
    kind, recipient_id = _caller(request)
    if not kind:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    # An empty/absent body is a legitimate no-op here, but a body that parses to a
    # non-dict (`5`, `[1]`) made data.get() raise AttributeError -> 500. Treat anything
    # that is not an object the same as no body at all.
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}

    session = get_session()
    try:
        if data.get("all"):
            model = Driver if kind == "driver" else User
            me = session.query(model).filter_by(id=recipient_id).first()
            joined_at = me.created_at if me else None
            wanted = [
                a.id for a in _visible_announcements(
                    session, kind, recipient_id, joined_at, _MAX_LIMIT
                )
            ]
        else:
            raw = data.get("ids") or []
            if not isinstance(raw, list):
                return web.json_response({"error": "ids ro'yxat bo'lishi kerak"},
                                         status=400)
            wanted = []
            for value in raw[:_MAX_LIMIT]:
                try:
                    wanted.append(int(value))
                except (TypeError, ValueError):
                    return web.json_response({"error": "ids faqat raqamlardan"},
                                             status=400)
            # Never let a caller mark someone else's announcement — or a nonexistent one —
            # as read, which would otherwise plant unreachable rows in the table.
            if wanted:
                allowed = {
                    row[0] for row in session.query(Announcement.id).filter(
                        Announcement.id.in_(wanted),
                        _audience_filter(kind, recipient_id),
                    ).all()
                }
                wanted = [i for i in wanted if i in allowed]

        already = _read_ids(session, kind, recipient_id, wanted)
        added = 0
        for announcement_id in wanted:
            if announcement_id in already:
                continue
            session.add(AnnouncementRead(
                announcement_id=announcement_id,
                recipient_type=kind,
                recipient_id=recipient_id,
            ))
            added += 1

        try:
            session.commit()
        except Exception as e:
            # Two rapid taps can both pass the "already read" check; the unique constraint
            # settles it. Treat the collision as success — the message IS read.
            session.rollback()
            logger.info("Mark-read collision for %s %s: %s", kind, recipient_id, e)
            added = 0

        return web.json_response({"success": True, "marked": added})
    finally:
        session.close()
