"""WebSocket manager for real-time order updates."""
import json
import logging
from typing import Set, Dict
from aiohttp import web, WSMsgType

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


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    """Handle WebSocket connection.

    Query params:
    - role: "driver" or "passenger"
    - id: telegram_id (for driver) or user_id (for passenger)
    - token: JWT token (for passenger only, optional for driver)
    """
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    role = request.query.get("role", "")
    client_id_str = request.query.get("id", "")

    try:
        client_id = int(client_id_str) if client_id_str else 0
    except ValueError:
        client_id = 0

    if role == "driver" and client_id:
        ws_manager.add_driver(client_id, ws)
        await ws.send_json({"type": "connected", "role": "driver"})
    elif role == "passenger" and client_id:
        ws_manager.add_passenger(client_id, ws)
        await ws.send_json({"type": "connected", "role": "passenger"})
    else:
        await ws.send_json({"type": "error", "error": "invalid role or id"})
        await ws.close()
        return ws

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
