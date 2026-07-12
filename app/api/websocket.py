"""WebSocket manager for real-time order updates."""
import json
import logging
from typing import Dict, Set

from aiohttp import WSMsgType, web

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
        self.broadcast_clients.discard(ws)
        for s in self.driver_clients.values():
            s.discard(ws)
        for s in self.passenger_clients.values():
            s.discard(ws)

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


def _verify_ws_identity(role: str, client_id: int, token: str) -> bool:
    """Verify the JWT token actually belongs to the claimed role + id.

    Without this any client could pass `role=passenger&id=<someone>` and receive
    another user's real-time order events (phone number revealed on accept, the
    driver's live GPS, etc.). We require a valid token whose subject matches the
    connecting id.

    - passenger: utils.auth token, `sub` (user id) must equal client_id
    - driver:    drivers._decode_driver_token, `telegram_id` must equal client_id
    """
    if not token:
        return False
    if role == "passenger":
        from app.utils.auth import decode_token
        payload = decode_token(token)
        if not payload:
            return False
        try:
            return int(payload.get("sub")) == client_id
        except (TypeError, ValueError):
            return False
    if role == "driver":
        # Lazy import to avoid a circular import (drivers.py imports ws_manager).
        from app.api.drivers import _decode_driver_token
        payload = _decode_driver_token(token)
        if not payload:
            return False
        try:
            return int(payload.get("telegram_id")) == client_id
        except (TypeError, ValueError):
            return False
    return False


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
    if role not in ("driver", "passenger") or not client_id or not _verify_ws_identity(role, client_id, token):
        await ws.send_json({"type": "error", "error": "unauthorized"})
        await ws.close()
        return ws

    if role == "driver":
        ws_manager.add_driver(client_id, ws)
        await ws.send_json({"type": "connected", "role": "driver"})
    else:
        ws_manager.add_passenger(client_id, ws)
        await ws.send_json({"type": "connected", "role": "passenger"})

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
        ws_manager.remove(ws)

    return ws
