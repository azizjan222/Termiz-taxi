import * as Haptics from 'expo-haptics';

import { WS_URL } from '../api/client';
import { type DriverOrder } from '../api/driver';
import { useRealtimeStore } from '../store/realtime';
import { playNewOrderAlert } from './notifications';
import { addNotification } from './notificationHistory';

// ---------------------------------------------------------------------------
// Single, app-wide realtime WebSocket manager.
//
// Owns exactly one WebSocket instance for the whole app, auto-reconnects with
// exponential backoff, sends a periodic keep-alive ping, detects a silently
// dead socket, and publishes incoming events into the realtime store. Living
// outside any one screen means real-time order delivery (and the loud alert)
// keeps working regardless of which screen is mounted.
// ---------------------------------------------------------------------------

let socket: WebSocket | null = null;
let currentId: string | null = null;
let intentionalClose = false;

// Reconnect (exponential backoff) state.
const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 15000];
let backoffIndex = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Keep-alive state.
const PING_INTERVAL_MS = 25000;
const ACTIVITY_TIMEOUT_MS = 35000;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastActivity = 0;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearPingTimer() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startKeepAlive() {
  clearPingTimer();
  lastActivity = Date.now();
  pingTimer = setInterval(() => {
    // If we haven't seen any traffic within the window, the socket is likely
    // half-open/dead — force a close so the onclose handler reconnects.
    if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
      try {
        socket?.close();
      } catch {}
      return;
    }
    try {
      socket?.send('ping');
    } catch {}
  }, PING_INTERVAL_MS);
}

function scheduleReconnect() {
  if (intentionalClose || currentId == null) return;
  clearReconnectTimer();
  const delay = BACKOFF_STEPS[Math.min(backoffIndex, BACKOFF_STEPS.length - 1)];
  backoffIndex += 1;
  useRealtimeStore.getState().setStatus('reconnecting');
  reconnectTimer = setTimeout(() => {
    if (intentionalClose || currentId == null) return;
    open(currentId);
  }, delay);
}

function handleMessage(data: any) {
  // The backend replies to our keep-alive 'ping' with the literal string 'pong'.
  if (data === 'pong') return;

  let msg: any;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'new_order' && msg.order) {
    const order = msg.order as DriverOrder;
    // Loud sound + strong vibration + haptic feedback for the new order. This
    // now fires globally (any screen) instead of only on the Orders tab.
    playNewOrderAlert({
      from: order.from_city,
      to: order.to_city,
      price: order.price,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addNotification({
      title: '🚕 Yangi zakas',
      body: `${order.from_city} → ${order.to_city}${order.price ? ` · ${order.price} so'm` : ''}`,
      type: 'new_order',
      data: { order_id: order.id },
    });
    useRealtimeStore.getState().pushNewOrder(order);
  } else if (msg.type === 'order_cancelled') {
    useRealtimeStore.getState().pushCancelled(msg.order_id);
  }
}

function open(telegramId: string) {
  intentionalClose = false;
  useRealtimeStore.getState().setStatus(backoffIndex > 0 ? 'reconnecting' : 'connecting');

  const ws = new WebSocket(`${WS_URL}?role=driver&id=${telegramId}`);
  socket = ws;

  ws.onopen = () => {
    backoffIndex = 0;
    useRealtimeStore.getState().setStatus('open');
    startKeepAlive();
  };

  ws.onmessage = (event) => {
    lastActivity = Date.now();
    try {
      handleMessage(event.data);
    } catch {}
  };

  ws.onerror = () => {
    // onclose will normally follow and drive the reconnect; guard anyway.
    clearPingTimer();
    scheduleReconnect();
  };

  ws.onclose = () => {
    clearPingTimer();
    if (socket === ws) socket = null;
    if (intentionalClose) {
      useRealtimeStore.getState().setStatus('closed');
      return;
    }
    scheduleReconnect();
  };
}

/**
 * Connect the app-wide socket for the given driver. Idempotent: if a socket is
 * already CONNECTING/OPEN for the same id this is a no-op; if the id changed the
 * existing socket is closed and a new one opened.
 */
export function connect(telegramId: number | string) {
  const id = String(telegramId);

  // Already connecting/open for the same driver -> nothing to do.
  if (
    socket &&
    currentId === id &&
    (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  // A different id (or no live socket): tear down any existing socket first.
  if (socket && currentId !== id) {
    const old = socket;
    socket = null;
    intentionalClose = true;
    clearReconnectTimer();
    clearPingTimer();
    try {
      old.close();
    } catch {}
  }

  currentId = id;
  backoffIndex = 0;
  open(id);
}

/** Cleanly close the socket and stop all timers (no reconnect). */
export function disconnect() {
  intentionalClose = true;
  currentId = null;
  backoffIndex = 0;
  clearReconnectTimer();
  clearPingTimer();
  if (socket) {
    const old = socket;
    socket = null;
    try {
      old.close();
    } catch {}
  }
  useRealtimeStore.getState().setStatus('closed');
}

/** Read whether the single socket is currently OPEN. */
export function isOpen(): boolean {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

/** Read the current connection status from the store. */
export function getStatus() {
  return useRealtimeStore.getState().status;
}
