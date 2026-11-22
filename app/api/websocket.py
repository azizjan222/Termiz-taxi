"""WebSocket manager for real-time order updates."""
import asyncio
import json
import logging
from typing import Dict, Set

from aiohttp import WSMsgType, web

from app.models import Driver, User

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Tracks connected WebSocket clients by user role."""

    def __init__(self):
        # All driver clients (Telegram ID -> set of websockets)
        self.driver_clients: Dict[int, Set[web.WebSocketResponse]] = {}
        # All passenger clients (user ID -> set of websockets)
        self.passenger_clients: Dict[int, Set[web.WebSocketResponse]] = {}
        # Generic broadcast channel (everyone listening to "orders")
        self.broadcast_clients: Set[web.WebSocketResponse] = set()

    def add_driver(self, telegram_id: int, ws: web.WebSocketResponse):
        self.driver_clients.setdefault(telegram_id, set()).add(ws)
        self.broadcast_clients.add(ws)

    def add_passenger(self, user_id: int, ws: web.WebSocketResponse):
        self.passenger_clients.setdefault(user_id, set()).add(ws)

    def remove(self, ws: web.WebSocketResponse):
        """Detach ``ws`` and drop any registry entry it leaves empty.

        The empty sets used to be kept forever, so both dicts grew by one permanent entry
        per driver/passenger that ever connected. That leaks memory for the lifetime of the
        process and makes every subsequent disconnect slower, because this method scans
        each dict in full — including the thousands of dead keys.
        """
        self.broadcast_clients.discard(ws)
        for registry in (self.driver_clients, self.passenger_clients):
            empty = []
            for key, sockets in registry.items():
                sockets.discard(ws)
                if not sockets:
                    empty.append(key)
            for key in empty:
                registry.pop(key, None)

    async def send_to_driver(self, telegram_id: int, message: dict):
        clients = self.driver_clients.get(telegram_id, set())
        await self._send_many(clients, message)

    async def send_to_passenger(self, user_id: int, message: dict):
        clients = self.passenger_clients.get(user_id, set())
        await self._send_many(clients, message)

    async def broadcast_to_drivers(self, message: dict):
        """Broadcast new order to all online drivers."""
        await self._send_many(self.broadcast_clients, message)

    async def _send_many(self, clients: Set[web.WebSocketResponse], message: dict):
        dead = []
        payload = json.dumps(message, ensure_ascii=False)
        for ws in list(clients):
            if ws.closed:
                dead.append(ws)
                continue
            try:
                await ws.send_str(payload)
            except Exception as e:
                logger.warning(f"WS send failed: {e}")
                dead.append(ws)
        for ws in dead:
            self.remove(ws)


# Global manager instance
ws_manager = WebSocketManager()


def _account_status(model, id_field: str, value: int) -> str:
    """Return 'ok', 'unauthorized', or 'transient_error' for the account lookup.

    Crucially separates genuine missing/blocked accounts from transient DB/pool hiccups:
    returning 'unauthorized' on a DB blip would wipe the mobile app's token and force
    an active driver out to the login screen mid-shift.
    """
    from app.database import get_session

    session = get_session()
    try:
        row = session.query(model).filter_by(**{id_field: value}).first()
        return "ok" if (bool(row) and not row.is_blocked) else "unauthorized"
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("WS identity lookup transient error (%s=%s): %s", id_field, value, e)
        return "transient_error"
    finally:
        session.close()


def _verify_driver_ws_account(driver_id: int | None, token_tg_id: int | None, client_id: int) -> str:
    """Verify driver WS identity using immutable Driver.id first, tolerating telegram_id links."""
    from app.database import get_session

    session = get_session()
    try:
        driver = None
        if driver_id is not None:
            driver = session.query(Driver).filter_by(id=driver_id).first()
        if driver is None:
            driver = session.query(Driver).filter_by(telegram_id=client_id).first()
        if not driver or driver.is_blocked:
            return "unauthorized"
        # Accept when either the DB row's current telegram_id OR the token's telegram_id matches
        # the connecting id — so linking/updating telegram_id never kicks out an active driver.
        if driver.telegram_id == client_id or (token_tg_id is not None and token_tg_id == client_id):
            return "ok"
        return "unauthorized"
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("WS driver lookup transient error (driver_id=%s, client_id=%s): %s", driver_id, client_id, e)
        return "transient_error"
    finally:
        session.close()


def _verify_ws_identity(role: str, client_id: int, token: str) -> str:
    """Verify the JWT token actually belongs to the claimed role + id.

    Returns one of: 'ok', 'unauthorized', or 'transient_error'.
    """
    if not token:
        return "unauthorized"
    if role == "passenger":
        from app.utils.auth import decode_token
        payload = decode_token(token)
        if not payload:
            return "unauthorized"
        if payload.get("role") not in (None, "passenger"):
            return "unauthorized"
        try:
            if int(payload.get("sub")) != client_id:
                return "unauthorized"
        except (TypeError, ValueError):
            return "unauthorized"
        return _account_status(User, "id", client_id)
    if role == "driver":
        # Lazy import to avoid a circular import (drivers.py imports ws_manager).
        from app.api.drivers import _decode_driver_token
        payload = _decode_driver_token(token)
        if not payload:
            return "unauthorized"
        driver_id: int | None = None
        token_tg_id: int | None = None
        try:
            if payload.get("sub") is not None:
                driver_id = int(payload.get("sub"))
        except (TypeError, ValueError):
            driver_id = None
        try:
            if payload.get("telegram_id") is not None:
                token_tg_id = int(payload.get("telegram_id"))
        except (TypeError, ValueError):
            token_tg_id = None
        if driver_id is None and token_tg_id != client_id:
            return "unauthorized"
        return _verify_driver_ws_account(driver_id, token_tg_id, client_id)
    return "unauthorized"


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    """Handle WebSocket connection.

    Query params:
    - role: "driver" or "passenger"
    - id: telegram_id (for driver) or user_id (for passenger)
    - token: JWT token (REQUIRED) — must match the claimed role + id
    """
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    role = request.query.get("role", "")
    client_id_str = request.query.get("id", "")
    token = request.query.get("token", "")

    try:
        client_id = int(client_id_str) if client_id_str else 0
    except ValueError:
        client_id = 0

    # Authenticate: the token must belong to the claimed role + id.
    if role not in ("driver", "passenger") or not client_id:
        await ws.send_json({"type": "error", "error": "unauthorized"})
        await ws.close()
        return ws

    auth_result = _verify_ws_identity(role, client_id, token)
    if auth_result == "transient_error":
        await ws.send_json({"type": "error", "error": "server_busy"})
        await ws.close(code=1013)
        return ws
    if auth_result != "ok":
        logger.warning("WS auth rejected: role=%s id=%s has_token=%s", role, client_id, bool(token))
        await ws.send_json({"type": "error", "error": "unauthorized"})
        await ws.close()
        return ws

    if role == "driver":
        ws_manager.add_driver(client_id, ws)
        await ws.send_json({"type": "connected", "role": "driver"})
    else:
        ws_manager.add_passenger(client_id, ws)
        await ws.send_json({"type": "connected", "role": "passenger"})

    async def _driver_heartbeat():
        try:
            while not ws.closed:
                await asyncio.sleep(15)
                if ws.closed:
                    break
                await ws.send_json({"type": "heartbeat"})
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    hb_task = asyncio.create_task(_driver_heartbeat()) if role == "driver" else None

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                # Handle ping or other client messages
                if msg.data == "ping":
                    await ws.send_str("pong")
            elif msg.type == WSMsgType.ERROR:
                logger.warning(f"WS error: {ws.exception()}")
                break
    finally:
        if hb_task is not None:
            hb_task.cancel()
        ws_manager.remove(ws)

    return ws
