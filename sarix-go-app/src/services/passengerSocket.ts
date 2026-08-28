import { WS_URL, getAuthToken } from '../api/client';

/**
 * Small reconnecting WebSocket helper for the passenger screens.
 *
 * `searching.tsx` and `order/[id].tsx` each opened a bare socket with
 * `ws.onerror = () => {}`, no `onclose` and no reconnect at all. A dropped connection was
 * therefore permanent for the life of the screen: the passenger stopped receiving
 * "driver found" and live driver positions, and the only thing still working was the
 * polling fallback (which is slower, and on the order screen was write-once for the
 * marker). The driver app has had proper backoff for a while — this brings the passenger
 * app to the same standard without duplicating the logic in two screens.
 *
 * Deliberately NOT a singleton like the driver's `realtime.ts`: these two screens are
 * short-lived and the backend keys clients by id into a Set, so a per-screen connection is
 * correct here. The returned handle must be closed on unmount.
 */

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 15000];
// Send a keep-alive well inside any proxy idle timeout, and treat silence as a dead socket.
const PING_INTERVAL_MS = 25000;
const ACTIVITY_TIMEOUT_MS = 35000;

export interface PassengerSocketHandle {
  /** Stop reconnecting and close the current socket. Safe to call more than once. */
  close: () => void;
  /** True while a socket is OPEN. */
  isOpen: () => boolean;
}

export interface PassengerSocketOptions {
  /** Passenger id used in the WS URL. */
  userId: number | string;
  /** Called for every decoded JSON frame. Never called for the literal 'pong'. */
  onMessage: (msg: any) => void;
  /** Called when the connection state changes, so a screen can surface it. */
  onStatusChange?: (open: boolean) => void;
}

export function connectPassengerSocket(
  opts: PassengerSocketOptions
): PassengerSocketHandle {
  const { userId, onMessage, onStatusChange } = opts;

  let socket: WebSocket | null = null;
  let closed = false;
  let backoffIndex = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastActivity = 0;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearPing = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const startKeepAlive = () => {
    clearPing();
    lastActivity = Date.now();
    pingTimer = setInterval(() => {
      // No traffic for a while means the socket is probably half-open: force a close so
      // onclose drives a reconnect.
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        try {
          socket?.close();
        } catch {}
        clearPing();
        return;
      }
      try {
        socket?.send('ping');
      } catch {}
    }, PING_INTERVAL_MS);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    clearReconnect();
    const delay = BACKOFF_STEPS[Math.min(backoffIndex, BACKOFF_STEPS.length - 1)];
    backoffIndex += 1;
    reconnectTimer = setTimeout(open, delay);
  };

  async function open() {
    if (closed) return;
    // Re-read the token on every attempt: a token refreshed (or cleared by a 401) between
    // attempts must not be carried over from the first connect.
    let token: string | null = null;
    try {
      token = await getAuthToken();
    } catch {}
    if (closed) return;

    const ws = new WebSocket(
      `${WS_URL}?role=passenger&id=${userId}&token=${encodeURIComponent(token || '')}`
    );
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return; // superseded
      backoffIndex = 0;
      onStatusChange?.(true);
      startKeepAlive();
    };

    ws.onmessage = (event) => {
      if (socket !== ws) return;
      lastActivity = Date.now();
      // The backend answers our keep-alive with the literal string 'pong'.
      if (event.data === 'pong') return;
      let msg: any;
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      // The server closes with this frame when the token does not verify. Retrying with the
      // same credentials is pointless — the global 401 handler owns signing the user out.
      if (msg.type === 'error') {
        if (msg.error === 'unauthorized') {
          closed = true;
          clearReconnect();
          clearPing();
        }
        return;
      }
      try {
        onMessage(msg);
      } catch {}
    };

    ws.onerror = () => {
      if (socket !== ws) return;
      clearPing();
      // onclose normally follows and drives the reconnect.
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      clearPing();
      socket = null;
      onStatusChange?.(false);
      if (closed) return;
      scheduleReconnect();
    };
  }

  open();

  return {
    close: () => {
      closed = true;
      clearReconnect();
      clearPing();
      if (socket) {
        const old = socket;
        socket = null;
        try {
          old.close();
        } catch {}
      }
    },
    isOpen: () => !!socket && socket.readyState === WebSocket.OPEN,
  };
}
