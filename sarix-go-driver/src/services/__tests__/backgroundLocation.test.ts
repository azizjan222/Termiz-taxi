/**
 * Background location is the one feature in this app that keeps running after the app is
 * gone, so the things worth testing are not "does it send a position" but "does it ever fail
 * to stop" and "can its two reporting paths both fall silent at once".
 *
 * The regression that motivated most of this file: `start` and `stop` were fire-and-forget
 * calls from the same React effect (cleanup stopped, body started), and on the pickup
 * transition they raced. One interleaving left the OS task stopped while the "background owns
 * reporting" flag stayed true — so the screen's own watcher stayed quiet too and NOTHING
 * reported for the rest of the trip. That state is now impossible, and
 * `isBackgroundSending()` must never disagree with the OS.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type TaskHandler = (arg: {
  data: unknown;
  error: { message?: string } | null;
}) => Promise<void>;

interface FakeWorld {
  osRunning: boolean;
  startCalls: number;
  stopCalls: number;
  fgStatus: string;
  /** What `getBackgroundPermissionsAsync` reports — i.e. already-granted or not. */
  bgStatus: string;
  /** What the OS prompt returns when we do ask. */
  bgRequestStatus: string;
  /** Artificial latency, used to force different interleavings. */
  latency: number;
  /** Make the OS stop call throw, without touching the module registry. */
  failStop: boolean;
  /** How many times the OS background-permission prompt was reached. */
  bgRequestCalls: number;
  storage: Map<string, string>;
  now: number;
  ack: { success: boolean; active_orders?: number };
  postError: (Error & { response?: { status: number } }) | null;
  posts: [number, number][];
  taskHandler: TaskHandler | null;
}

/**
 * The single mutable fake the mocks read from, so a test can steer the OS, the clock, storage
 * and the backend without touching the module registry.
 *
 * The `mock` prefix on this and on `mockSleep` is REQUIRED, not stylistic:
 * babel-plugin-jest-hoist lifts `jest.mock()` calls above the imports and rejects factories
 * that close over out-of-scope variables, whitelisting only names it can see are
 * mock-related. Renaming these to something tidier makes every suite in this file fail to
 * run with "The module factory of jest.mock() is not allowed to reference any out-of-scope
 * variables".
 */
const mockWorld: FakeWorld = {
  osRunning: false,
  startCalls: 0,
  stopCalls: 0,
  fgStatus: 'granted',
  bgStatus: 'granted',
  bgRequestStatus: 'granted',
  latency: 0,
  failStop: false,
  bgRequestCalls: 0,
  storage: new Map(),
  now: 1_700_000_000_000,
  ack: { success: true, active_orders: 1 },
  postError: null,
  posts: [],
  taskHandler: null,
};

const mockSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Yield to the microtask queue so queued promise chains can advance. */
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 3 },
  hasStartedLocationUpdatesAsync: async () => {
    if (mockWorld.latency) await mockSleep(mockWorld.latency);
    return mockWorld.osRunning;
  },
  startLocationUpdatesAsync: async () => {
    if (mockWorld.latency) await mockSleep(mockWorld.latency);
    mockWorld.startCalls += 1;
    mockWorld.osRunning = true;
  },
  stopLocationUpdatesAsync: async () => {
    if (mockWorld.latency) await mockSleep(mockWorld.latency);
    if (mockWorld.failStop) throw new Error('stopLocationUpdatesAsync failed');
    mockWorld.stopCalls += 1;
    mockWorld.osRunning = false;
  },
  requestForegroundPermissionsAsync: async () => ({ status: mockWorld.fgStatus }),
  getBackgroundPermissionsAsync: async () => ({ status: mockWorld.bgStatus }),
  requestBackgroundPermissionsAsync: async () => {
    mockWorld.bgRequestCalls += 1;
    return { status: mockWorld.bgRequestStatus };
  },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, handler: TaskHandler) => {
    mockWorld.taskHandler = handler;
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => (mockWorld.storage.has(k) ? mockWorld.storage.get(k)! : null),
  setItem: async (k: string, v: string) => {
    mockWorld.storage.set(k, v);
  },
  removeItem: async (k: string) => {
    mockWorld.storage.delete(k);
  },
}));

jest.mock('../../api/driver', () => ({
  updateDriverLocation: async (lat: number, lon: number) => {
    mockWorld.posts.push([lat, lon]);
    if (mockWorld.postError) throw mockWorld.postError;
    return mockWorld.ack;
  },
}));

type Module = typeof import('../backgroundLocation');

/**
 * Fresh module per test: the service keeps real state (the operation queue, the cached flag,
 * the throttle timestamp, the counters), and leaking any of it between tests would hide
 * exactly the kind of bug these tests exist to catch. Re-importing also re-runs `defineTask`,
 * so `mockWorld.taskHandler` always belongs to the instance under test.
 *
 * Loaded with `require` rather than a dynamic `import()`: jest-expo runs this suite as CJS,
 * where `import()` throws "A dynamic import callback was invoked without
 * --experimental-vm-modules".
 */
function load(): Module {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../backgroundLocation') as Module;
}

const fix = (lat = 41.1, lon = 69.2) => ({
  data: { locations: [{ coords: { latitude: lat, longitude: lon } }] },
  error: null,
});

const labels = { title: 'Safar davom etmoqda', body: 'Joylashuv yuborilmoqda' };
const allow = async () => true;
const deny = async () => false;

beforeEach(() => {
  mockWorld.osRunning = false;
  mockWorld.startCalls = 0;
  mockWorld.stopCalls = 0;
  mockWorld.fgStatus = 'granted';
  mockWorld.bgStatus = 'granted';
  mockWorld.bgRequestStatus = 'granted';
  mockWorld.latency = 0;
  mockWorld.failStop = false;
  mockWorld.bgRequestCalls = 0;
  mockWorld.storage = new Map();
  mockWorld.now = 1_700_000_000_000;
  mockWorld.ack = { success: true, active_orders: 1 };
  mockWorld.postError = null;
  mockWorld.posts = [];
  mockWorld.taskHandler = null;
  jest.spyOn(Date, 'now').mockImplementation(() => mockWorld.now);
});

describe('start/stop serialization', () => {
  it('never leaves the flag claiming to report while the OS task is stopped', async () => {
    // The exact fatal interleaving from the old implementation: a stop already in flight
    // when a start begins. Latency makes both straddle several awaits, which is what let
    // them observe each other's pre-state.
    for (const latency of [0, 1, 3]) {
      const mod = load();
      mockWorld.latency = latency;
      mockWorld.osRunning = true; // mid-trip: the task is already running

      const stopping = mod.stopBackgroundLocation();
      const starting = mod.startBackgroundLocation({ orderId: 7, labels, confirm: allow });
      await Promise.all([stopping, starting]);

      // The invariant. `true` here with `osRunning === false` is the bug: the screen's
      // watcher would skip its POST while nothing else was sending either.
      expect(mod.isBackgroundSending()).toBe(mockWorld.osRunning);
      mockWorld.osRunning = false;
      mockWorld.storage.clear();
    }
  });

  it('leaves tracking running when start is the last operation', async () => {
    const mod = load();
    mockWorld.latency = 2;
    mockWorld.osRunning = true;

    await Promise.all([
      mod.stopBackgroundLocation(),
      mod.startBackgroundLocation({ orderId: 7, labels, confirm: allow }),
    ]);

    expect(mockWorld.osRunning).toBe(true);
    expect(mod.isBackgroundSending()).toBe(true);
    // And the session is claimed again, so the task will not self-stop.
    expect(mockWorld.storage.get('sarixgo_driver_bg_location')).toContain('"orderId":"7"');
  });

  it('a rejected stop does not wedge the queue', async () => {
    const mod = load();
    mockWorld.osRunning = true;
    mockWorld.failStop = true;

    await mod.stopBackgroundLocation();

    // The next operation still runs — `serialize` continues past a rejection. A queue that
    // stalled here would leave the driver with no tracking for the rest of the session and
    // no way to recover short of restarting the app.
    mockWorld.failStop = false;
    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: allow });
    expect(ok).toBe(true);
  });
});

describe('starting', () => {
  it('does not restart or re-ask when already tracking the same order', async () => {
    const mod = load();
    let confirmCalls = 0;
    const confirm = async () => {
      confirmCalls += 1;
      return true;
    };
    mockWorld.bgStatus = 'undetermined'; // force the disclosure path on the first call

    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });

    // One OS start, one disclosure. This is what stops the foreground-service notification
    // from flickering every time the order screen re-runs its effect.
    expect(mockWorld.startCalls).toBe(1);
    expect(confirmCalls).toBe(1);
  });

  it('keeps the original deadline baseline across restarts for the same order', async () => {
    const mod = load();
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm: allow });
    const first = JSON.parse(mockWorld.storage.get('sarixgo_driver_bg_location')!).startedAt;

    mockWorld.now += 60 * 60 * 1000;
    mockWorld.osRunning = false; // OS dropped the service; the screen re-arms it
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm: allow });

    const second = JSON.parse(mockWorld.storage.get('sarixgo_driver_bg_location')!).startedAt;
    // A remounting screen must not be able to push the 6-hour safety stop out forever.
    expect(second).toBe(first);
  });

  it('refuses background permission without an accepted disclosure', async () => {
    const mod = load();
    mockWorld.bgStatus = 'undetermined';

    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: deny });

    expect(ok).toBe(false);
    // Play policy: the OS prompt must not appear before the driver accepted the in-app
    // explanation. Asking first is what gets an app's updates blocked.
    expect(mockWorld.bgRequestCalls).toBe(0);
    expect(mockWorld.startCalls).toBe(0);
  });

  it('skips the disclosure when background permission is already granted', async () => {
    const mod = load();
    mockWorld.bgStatus = 'granted';
    let confirmCalls = 0;

    const ok = await mod.startBackgroundLocation({
      orderId: 1,
      labels,
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
    });

    expect(ok).toBe(true);
    // A driver who already chose "Allow all the time" must not be re-interrogated at the
    // start of every trip.
    expect(confirmCalls).toBe(0);
    expect(mockWorld.bgRequestCalls).toBe(0);
  });

  it('returns false without starting when foreground permission is denied', async () => {
    const mod = load();
    mockWorld.fgStatus = 'denied';
    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: allow });
    expect(ok).toBe(false);
    expect(mockWorld.startCalls).toBe(0);
  });
});

describe('the task', () => {
  const start = async (mod: Module) => {
    await mod.startBackgroundLocation({ orderId: 5, labels, confirm: allow });
  };

  it('posts only the freshest fix from a buffered batch', async () => {
    const mod = load();
    await start(mod);
    await mockWorld.taskHandler!({
      data: {
        locations: [
          { coords: { latitude: 1, longitude: 1 } },
          { coords: { latitude: 2, longitude: 2 } },
          { coords: { latitude: 3, longitude: 3 } },
        ],
      },
      error: null,
    });
    expect(mockWorld.posts).toEqual([[3, 3]]);
  });

  it('throttles to the existing ~10s backend cadence', async () => {
    const mod = load();
    await start(mod);
    await mockWorld.taskHandler!(fix(1, 1));
    mockWorld.now += 3000;
    await mockWorld.taskHandler!(fix(2, 2));
    mockWorld.now += 8000;
    await mockWorld.taskHandler!(fix(3, 3));

    expect(mockWorld.posts).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('stops itself once the backend reports no active orders', async () => {
    const mod = load();
    await start(mod);
    mockWorld.ack = { success: true, active_orders: 0 };

    await mockWorld.taskHandler!(fix());
    await flush();

    expect(mockWorld.osRunning).toBe(false);
    expect(mod.isBackgroundSending()).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe(
      'no-active-orders',
    );
  });

  it('keeps going when the backend omits active_orders (older deploy)', async () => {
    const mod = load();
    await start(mod);
    mockWorld.ack = { success: true }; // field absent

    await mockWorld.taskHandler!(fix());
    await flush();

    // `undefined` must never be read as zero: that would stop tracking on every trip for
    // anyone whose backend has not been deployed yet.
    expect(mockWorld.osRunning).toBe(true);
  });

  it('stops itself when no session claims it', async () => {
    const mod = load();
    await start(mod);
    // The app was updated, or storage was cleared, while the OS kept the service alive.
    mockWorld.storage.delete('sarixgo_driver_bg_location');

    await mockWorld.taskHandler!(fix());
    await flush();

    expect(mockWorld.osRunning).toBe(false);
    expect(mockWorld.posts).toEqual([]); // and it did NOT report for an unknown order
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe(
      'no-tracking-state',
    );
  });

  it('stops itself after the maximum tracking duration', async () => {
    const mod = load();
    await start(mod);

    mockWorld.now += 6 * 60 * 60 * 1000 + 1000;
    await mockWorld.taskHandler!(fix());
    await flush();

    // The force-quit case: no app code ever runs again, so this deadline is the only thing
    // that can end the session.
    expect(mockWorld.osRunning).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe('max-duration');
  });

  it('stops itself when the session is rejected', async () => {
    const mod = load();
    await start(mod);
    const err = new Error('unauthorized') as Error & { response?: { status: number } };
    err.response = { status: 401 };
    mockWorld.postError = err;

    await mockWorld.taskHandler!(fix());
    await flush();

    expect(mockWorld.osRunning).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe('unauthorized');
  });

  it('retries immediately after a network failure instead of waiting out the interval', async () => {
    const mod = load();
    await start(mod);
    mockWorld.postError = new Error('offline');

    await mockWorld.taskHandler!(fix(1, 1));
    mockWorld.postError = null;
    mockWorld.now += 500; // well inside the throttle window
    await mockWorld.taskHandler!(fix(2, 2));

    expect(mockWorld.posts).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(mockWorld.osRunning).toBe(true); // a plain network error must not end tracking

    const diag = await mod.getBackgroundLocationDiagnostics();
    expect(diag.failed).toBe(1);
    expect(diag.sent).toBe(1);
  });

  it('ignores batches with an error or unusable coordinates', async () => {
    const mod = load();
    await start(mod);

    await mockWorld.taskHandler!({ data: null, error: { message: 'no fix' } });
    await mockWorld.taskHandler!({ data: { locations: [] }, error: null });
    await mockWorld.taskHandler!({
      data: { locations: [{ coords: { latitude: null, longitude: 5 } }] },
      error: null,
    });

    expect(mockWorld.posts).toEqual([]);
    expect(mockWorld.osRunning).toBe(true);
    expect((await mod.getBackgroundLocationDiagnostics()).dropped).toBe(3);
  });
});

describe('stopping', () => {
  it('clears the session even when the OS call fails', async () => {
    const mod = load();
    await mod.startBackgroundLocation({ orderId: 9, labels, confirm: allow });
    mockWorld.failStop = true;

    await mod.stopBackgroundLocation();

    // The session record is dropped first precisely so a failed OS call cannot strand a
    // running service: the next task invocation finds no state and stops itself.
    expect(mockWorld.storage.has('sarixgo_driver_bg_location')).toBe(false);
    mockWorld.failStop = false;
    await mockWorld.taskHandler!(fix());
    await flush();
    expect(mockWorld.osRunning).toBe(false);
    expect(mockWorld.posts).toEqual([]);
  });

  it('is safe when tracking was never started', async () => {
    const mod = load();
    await expect(mod.stopBackgroundLocation()).resolves.toBeUndefined();
    expect(mockWorld.stopCalls).toBe(0);
  });
});

describe('syncBackgroundLocationState', () => {
  it('recovers the flag after a cold start with the service still alive', async () => {
    const mod = load();
    // Fresh JS context (flag defaults to false) but the OS service survived the kill.
    mockWorld.osRunning = true;
    expect(mod.isBackgroundSending()).toBe(false);

    await mod.syncBackgroundLocationState();

    // Without this the order screen would double-report every fix.
    expect(mod.isBackgroundSending()).toBe(true);
  });
});
