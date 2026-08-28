/**
 * Realtime socket-manager tests.
 *
 * This module had zero coverage despite owning order delivery for the whole driver app, and
 * it was just rewritten to fix a bug where an expired token produced an infinite silent
 * reconnect loop while the UI still showed "Onlayn". These tests pin the parts of that fix
 * that are easy to regress:
 *
 *   - the token is re-read from storage on EVERY attempt (it used to be cached from the
 *     first connect, so a token cleared by a 401 was reused forever);
 *   - an `{"type":"error","error":"unauthorized"}` frame stops the loop instead of being
 *     silently dropped;
 *   - reconnects are scheduled with backoff after an unexpected close, and NOT after an
 *     intentional disconnect;
 *   - connect() is idempotent and never leaves two concurrent sockets.
 *
 * The module is pure TS (no React), so a fake global WebSocket plus fake timers is enough.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// --- mocks must be registered before the module under test is imported -----------------

// These MUST be named `mock*`: babel-plugin-jest-hoist lifts jest.mock() above the imports
// and rejects factories that reference any other out-of-scope variable.
let mockStoredToken: string | null = 'tok-1';
const mockNotifyUnauthorized = jest.fn();

jest.mock('../../api/client', () => ({
  WS_URL: 'wss://example.test/ws',
  getAuthToken: () => Promise.resolve(mockStoredToken),
  notifyUnauthorized: () => mockNotifyUnauthorized(),
  // Also consumed by src/api/driver.ts and src/store/driver.ts, which get pulled in
  // transitively; only referenced inside functions, but the exports must exist.
  clearAuthToken: () => Promise.resolve(),
  setAuthToken: () => Promise.resolve(),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  API_URL: 'https://example.test',
}));

// Keep the alert/notification side effects out of these tests.
jest.mock('../notifications', () => ({
  playNewOrderAlert: jest.fn(),
  playOrderCancelledAlert: jest.fn(),
  newOrderBody: () => 'body',
}));
jest.mock('../notificationHistory', () => ({ addNotification: jest.fn() }));

// realtime.ts only reads `isOnline` and `driver?.telegram_id` off the driver store. Faking
// it keeps expo-secure-store and the whole api layer out of this test.
const mockDriverState: { isOnline: boolean; driver: { telegram_id: number } | null } = {
  isOnline: true,
  driver: null,
};
jest.mock('../../store/driver', () => ({
  useDriverStore: { getState: () => mockDriverState },
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('../../i18n', () => ({ __esModule: true, default: { t: (k: string) => k } }));

// --- fake WebSocket -------------------------------------------------------------------

type Handler = ((ev?: any) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: Handler = null;
  onmessage: Handler = null;
  onerror: Handler = null;
  onclose: Handler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  // --- helpers for the tests ---
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(data: any) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  /** Server-side close (not requested by us). */
  simulateServerClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!ws) throw new Error('no WebSocket was constructed');
    return ws;
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

// Installed here and re-asserted in beforeEach: ES imports are hoisted, so the module under
// test is loaded first — that is fine because it only touches WebSocket at call time.
(global as any).WebSocket = FakeWebSocket;

// --- module under test ----------------------------------------------------------------

import * as realtime from '../realtime';
import { useRealtimeStore } from '../../store/realtime';

/** Let the token promise inside connect()/reconnect resolve. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('realtime socket manager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).WebSocket = FakeWebSocket;
    FakeWebSocket.reset();
    mockNotifyUnauthorized.mockClear();
    mockStoredToken = 'tok-1';
    useRealtimeStore.setState({ status: 'closed', lastEvent: null });
    mockDriverState.isOnline = true;
    mockDriverState.driver = null;
  });

  afterEach(() => {
    realtime.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('opens one socket carrying the current token and reports open', async () => {
    realtime.connect(555);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.url).toContain('role=driver');
    expect(FakeWebSocket.last.url).toContain('id=555');
    expect(FakeWebSocket.last.url).toContain('token=tok-1');

    FakeWebSocket.last.simulateOpen();
    expect(useRealtimeStore.getState().status).toBe('open');
    expect(realtime.isOpen()).toBe(true);
  });

  it('re-reads the token on a reconnect instead of reusing the first one', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    // The token is rotated (or, as after a 401, cleared) while we are connected.
    mockStoredToken = 'tok-2';
    FakeWebSocket.last.simulateServerClose();

    // First backoff step.
    jest.advanceTimersByTime(1000);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.url).toContain('token=tok-2');
  });

  it('stops reconnecting and signals the app on an unauthorized frame', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage({ type: 'error', error: 'unauthorized' });

    expect(useRealtimeStore.getState().status).toBe('unauthorized');
    expect(mockNotifyUnauthorized).toHaveBeenCalledTimes(1);

    // The socket then closes, and that must NOT start the loop again.
    FakeWebSocket.last.simulateServerClose();
    jest.advanceTimersByTime(60000);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects with backoff after an unexpected close', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateServerClose();
    expect(useRealtimeStore.getState().status).toBe('reconnecting');

    // Nothing before the first step elapses.
    jest.advanceTimersByTime(999);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(1);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect after disconnect()', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    realtime.disconnect();
    expect(useRealtimeStore.getState().status).toBe('closed');

    jest.advanceTimersByTime(60000);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('can reconnect after a disconnect() — logging out must not latch the socket shut', async () => {
    // Regression: disconnect() set intentionalClose = true and nothing ever cleared it,
    // while openWithFreshToken() refuses to open while it is set. A driver who logged out
    // and back in got NO socket for the rest of the process: the UI showed a green
    // "Onlayn" and not a single order arrived until the app was force-killed.
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();
    realtime.disconnect();

    realtime.connect(555);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.simulateOpen();
    expect(realtime.isOpen()).toBe(true);
    expect(useRealtimeStore.getState().status).toBe('open');
  });

  it('can reconnect after an unauthorized frame once the driver signs in again', async () => {
    // Same latch, reached via handleUnauthorized(). The app's 401 handler signs the driver
    // out and back in; that has to be able to open a socket again.
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateMessage({ type: 'error', error: 'unauthorized' });
    expect(useRealtimeStore.getState().status).toBe('unauthorized');

    mockStoredToken = 'tok-fresh';
    realtime.connect(555);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.url).toContain('token=tok-fresh');
  });

  it('connect() is idempotent for the same driver while the socket is live', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    realtime.connect(555);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('publishes a new_order event when online', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage({
      type: 'new_order',
      order: { id: 77, from_city: 'Termiz', to_city: 'Denov', price: 90000 },
    });

    const ev = useRealtimeStore.getState().lastEvent!;
    expect(ev.kind).toBe('new_order');
    expect(ev.order?.id).toBe(77);
  });

  it('ignores a new_order while the driver is offline', async () => {
    mockDriverState.isOnline = false;
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage({
      type: 'new_order',
      order: { id: 88, from_city: 'Termiz', to_city: 'Denov', price: 1 },
    });

    expect(useRealtimeStore.getState().lastEvent).toBeNull();
  });

  it('publishes a cancellation', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage({ type: 'order_cancelled', order_id: 99 });

    expect(useRealtimeStore.getState().lastEvent).toMatchObject({
      kind: 'order_cancelled',
      orderId: 99,
    });
  });

  it("ignores an order_taken caused by this driver's own accept", async () => {
    mockDriverState.driver = { telegram_id: 555 };
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage({
      type: 'order_taken',
      order_id: 5,
      driver_telegram_id: 555,
    });
    expect(useRealtimeStore.getState().lastEvent).toBeNull();

    // Another driver winning it IS published, so the list/popup can drop the order.
    FakeWebSocket.last.simulateMessage({
      type: 'order_taken',
      order_id: 6,
      driver_telegram_id: 999,
    });
    expect(useRealtimeStore.getState().lastEvent).toMatchObject({
      kind: 'order_taken',
      orderId: 6,
    });
  });

  it('ignores keep-alive pongs and malformed frames', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    FakeWebSocket.last.simulateMessage('pong');
    FakeWebSocket.last.simulateMessage('not json at all');
    FakeWebSocket.last.simulateMessage('42');

    expect(useRealtimeStore.getState().lastEvent).toBeNull();
  });

  it('sends a keep-alive ping on the interval', async () => {
    realtime.connect(555);
    await flush();
    FakeWebSocket.last.simulateOpen();

    jest.advanceTimersByTime(25000);
    expect(FakeWebSocket.last.sent).toContain('ping');
  });
});
