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
  posts: Array<[number, number]>;
  taskHandler: TaskHandler | null;
}

const world: FakeWorld = {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Yield to the microtask queue so queued promise chains can advance. */
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 3 },
  hasStartedLocationUpdatesAsync: async () => {
    if (world.latency) await sleep(world.latency);
    return world.osRunning;
  },
  startLocationUpdatesAsync: async () => {
    if (world.latency) await sleep(world.latency);
    world.startCalls += 1;
    world.osRunning = true;
  },
  stopLocationUpdatesAsync: async () => {
    if (world.latency) await sleep(world.latency);
    if (world.failStop) throw new Error('stopLocationUpdatesAsync failed');
    world.stopCalls += 1;
    world.osRunning = false;
  },
  requestForegroundPermissionsAsync: async () => ({ status: world.fgStatus }),
  getBackgroundPermissionsAsync: async () => ({ status: world.bgStatus }),
  requestBackgroundPermissionsAsync: async () => {
    world.bgRequestCalls += 1;
    return { status: world.bgRequestStatus };
  },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, handler: TaskHandler) => {
    world.taskHandler = handler;
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => (world.storage.has(k) ? world.storage.get(k)! : null),
  setItem: async (k: string, v: string) => {
    world.storage.set(k, v);
  },
  removeItem: async (k: string) => {
    world.storage.delete(k);
  },
}));

jest.mock('../../api/driver', () => ({
  updateDriverLocation: async (lat: number, lon: number) => {
    world.posts.push([lat, lon]);
    if (world.postError) throw world.postError;
    return world.ack;
  },
}));

type Module = typeof import('../backgroundLocation');

/**
 * Fresh module per test: the service keeps real state (the operation queue, the cached flag,
 * the throttle timestamp, the counters), and leaking any of it between tests would hide
 * exactly the kind of bug these tests exist to catch. Re-importing also re-runs `defineTask`,
 * so `world.taskHandler` always belongs to the instance under test.
 */
async function load(): Promise<Module> {
  jest.resetModules();
  return import('../backgroundLocation');
}

const fix = (lat = 41.1, lon = 69.2) => ({
  data: { locations: [{ coords: { latitude: lat, longitude: lon } }] },
  error: null,
});

const labels = { title: 'Safar davom etmoqda', body: 'Joylashuv yuborilmoqda' };
const allow = async () => true;
const deny = async () => false;

beforeEach(() => {
  world.osRunning = false;
  world.startCalls = 0;
  world.stopCalls = 0;
  world.fgStatus = 'granted';
  world.bgStatus = 'granted';
  world.bgRequestStatus = 'granted';
  world.latency = 0;
  world.failStop = false;
  world.bgRequestCalls = 0;
  world.storage = new Map();
  world.now = 1_700_000_000_000;
  world.ack = { success: true, active_orders: 1 };
  world.postError = null;
  world.posts = [];
  world.taskHandler = null;
  jest.spyOn(Date, 'now').mockImplementation(() => world.now);
});

describe('start/stop serialization', () => {
  it('never leaves the flag claiming to report while the OS task is stopped', async () => {
    // The exact fatal interleaving from the old implementation: a stop already in flight
    // when a start begins. Latency makes both straddle several awaits, which is what let
    // them observe each other's pre-state.
    for (const latency of [0, 1, 3]) {
      const mod = await load();
      world.latency = latency;
      world.osRunning = true; // mid-trip: the task is already running

      const stopping = mod.stopBackgroundLocation();
      const starting = mod.startBackgroundLocation({ orderId: 7, labels, confirm: allow });
      await Promise.all([stopping, starting]);

      // The invariant. `true` here with `osRunning === false` is the bug: the screen's
      // watcher would skip its POST while nothing else was sending either.
      expect(mod.isBackgroundSending()).toBe(world.osRunning);
      world.osRunning = false;
      world.storage.clear();
    }
  });

  it('leaves tracking running when start is the last operation', async () => {
    const mod = await load();
    world.latency = 2;
    world.osRunning = true;

    await Promise.all([
      mod.stopBackgroundLocation(),
      mod.startBackgroundLocation({ orderId: 7, labels, confirm: allow }),
    ]);

    expect(world.osRunning).toBe(true);
    expect(mod.isBackgroundSending()).toBe(true);
    // And the session is claimed again, so the task will not self-stop.
    expect(world.storage.get('sarixgo_driver_bg_location')).toContain('"orderId":"7"');
  });

  it('a rejected stop does not wedge the queue', async () => {
    const mod = await load();
    world.osRunning = true;
    world.failStop = true;

    await mod.stopBackgroundLocation();

    // The next operation still runs — `serialize` continues past a rejection. A queue that
    // stalled here would leave the driver with no tracking for the rest of the session and
    // no way to recover short of restarting the app.
    world.failStop = false;
    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: allow });
    expect(ok).toBe(true);
  });
});

describe('starting', () => {
  it('does not restart or re-ask when already tracking the same order', async () => {
    const mod = await load();
    let confirmCalls = 0;
    const confirm = async () => {
      confirmCalls += 1;
      return true;
    };
    world.bgStatus = 'undetermined'; // force the disclosure path on the first call

    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm });

    // One OS start, one disclosure. This is what stops the foreground-service notification
    // from flickering every time the order screen re-runs its effect.
    expect(world.startCalls).toBe(1);
    expect(confirmCalls).toBe(1);
  });

  it('keeps the original deadline baseline across restarts for the same order', async () => {
    const mod = await load();
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm: allow });
    const first = JSON.parse(world.storage.get('sarixgo_driver_bg_location')!).startedAt;

    world.now += 60 * 60 * 1000;
    world.osRunning = false; // OS dropped the service; the screen re-arms it
    await mod.startBackgroundLocation({ orderId: 42, labels, confirm: allow });

    const second = JSON.parse(world.storage.get('sarixgo_driver_bg_location')!).startedAt;
    // A remounting screen must not be able to push the 6-hour safety stop out forever.
    expect(second).toBe(first);
  });

  it('refuses background permission without an accepted disclosure', async () => {
    const mod = await load();
    world.bgStatus = 'undetermined';

    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: deny });

    expect(ok).toBe(false);
    // Play policy: the OS prompt must not appear before the driver accepted the in-app
    // explanation. Asking first is what gets an app's updates blocked.
    expect(world.bgRequestCalls).toBe(0);
    expect(world.startCalls).toBe(0);
  });

  it('skips the disclosure when background permission is already granted', async () => {
    const mod = await load();
    world.bgStatus = 'granted';
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
    expect(world.bgRequestCalls).toBe(0);
  });

  it('returns false without starting when foreground permission is denied', async () => {
    const mod = await load();
    world.fgStatus = 'denied';
    const ok = await mod.startBackgroundLocation({ orderId: 1, labels, confirm: allow });
    expect(ok).toBe(false);
    expect(world.startCalls).toBe(0);
  });
});

describe('the task', () => {
  const start = async (mod: Module) => {
    await mod.startBackgroundLocation({ orderId: 5, labels, confirm: allow });
  };

  it('posts only the freshest fix from a buffered batch', async () => {
    const mod = await load();
    await start(mod);
    await world.taskHandler!({
      data: {
        locations: [
          { coords: { latitude: 1, longitude: 1 } },
          { coords: { latitude: 2, longitude: 2 } },
          { coords: { latitude: 3, longitude: 3 } },
        ],
      },
      error: null,
    });
    expect(world.posts).toEqual([[3, 3]]);
  });

  it('throttles to the existing ~10s backend cadence', async () => {
    const mod = await load();
    await start(mod);
    await world.taskHandler!(fix(1, 1));
    world.now += 3000;
    await world.taskHandler!(fix(2, 2));
    world.now += 8000;
    await world.taskHandler!(fix(3, 3));

    expect(world.posts).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('stops itself once the backend reports no active orders', async () => {
    const mod = await load();
    await start(mod);
    world.ack = { success: true, active_orders: 0 };

    await world.taskHandler!(fix());
    await flush();

    expect(world.osRunning).toBe(false);
    expect(mod.isBackgroundSending()).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe(
      'no-active-orders',
    );
  });

  it('keeps going when the backend omits active_orders (older deploy)', async () => {
    const mod = await load();
    await start(mod);
    world.ack = { success: true }; // field absent

    await world.taskHandler!(fix());
    await flush();

    // `undefined` must never be read as zero: that would stop tracking on every trip for
    // anyone whose backend has not been deployed yet.
    expect(world.osRunning).toBe(true);
  });

  it('stops itself when no session claims it', async () => {
    const mod = await load();
    await start(mod);
    // The app was updated, or storage was cleared, while the OS kept the service alive.
    world.storage.delete('sarixgo_driver_bg_location');

    await world.taskHandler!(fix());
    await flush();

    expect(world.osRunning).toBe(false);
    expect(world.posts).toEqual([]); // and it did NOT report for an unknown order
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe(
      'no-tracking-state',
    );
  });

  it('stops itself after the maximum tracking duration', async () => {
    const mod = await load();
    await start(mod);

    world.now += 6 * 60 * 60 * 1000 + 1000;
    await world.taskHandler!(fix());
    await flush();

    // The force-quit case: no app code ever runs again, so this deadline is the only thing
    // that can end the session.
    expect(world.osRunning).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe('max-duration');
  });

  it('stops itself when the session is rejected', async () => {
    const mod = await load();
    await start(mod);
    const err = new Error('unauthorized') as Error & { response?: { status: number } };
    err.response = { status: 401 };
    world.postError = err;

    await world.taskHandler!(fix());
    await flush();

    expect(world.osRunning).toBe(false);
    expect((await mod.getBackgroundLocationDiagnostics()).stoppedReason).toBe('unauthorized');
  });

  it('retries immediately after a network failure instead of waiting out the interval', async () => {
    const mod = await load();
    await start(mod);
    world.postError = new Error('offline');

    await world.taskHandler!(fix(1, 1));
    world.postError = null;
    world.now += 500; // well inside the throttle window
    await world.taskHandler!(fix(2, 2));

    expect(world.posts).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(world.osRunning).toBe(true); // a plain network error must not end tracking

    const diag = await mod.getBackgroundLocationDiagnostics();
    expect(diag.failed).toBe(1);
    expect(diag.sent).toBe(1);
  });

  it('ignores batches with an error or unusable coordinates', async () => {
    const mod = await load();
    await start(mod);

    await world.taskHandler!({ data: null, error: { message: 'no fix' } });
    await world.taskHandler!({ data: { locations: [] }, error: null });
    await world.taskHandler!({
      data: { locations: [{ coords: { latitude: null, longitude: 5 } }] },
      error: null,
    });

    expect(world.posts).toEqual([]);
    expect(world.osRunning).toBe(true);
    expect((await mod.getBackgroundLocationDiagnostics()).dropped).toBe(3);
  });
});

describe('stopping', () => {
  it('clears the session even when the OS call fails', async () => {
    const mod = await load();
    await mod.startBackgroundLocation({ orderId: 9, labels, confirm: allow });
    world.failStop = true;

    await mod.stopBackgroundLocation();

    // The session record is dropped first precisely so a failed OS call cannot strand a
    // running service: the next task invocation finds no state and stops itself.
    expect(world.storage.has('sarixgo_driver_bg_location')).toBe(false);
    world.failStop = false;
    await world.taskHandler!(fix());
    await flush();
    expect(world.osRunning).toBe(false);
    expect(world.posts).toEqual([]);
  });

  it('is safe when tracking was never started', async () => {
    const mod = await load();
    await expect(mod.stopBackgroundLocation()).resolves.toBeUndefined();
    expect(world.stopCalls).toBe(0);
  });
});

describe('syncBackgroundLocationState', () => {
  it('recovers the flag after a cold start with the service still alive', async () => {
    const mod = await load();
    // Fresh JS context (flag defaults to false) but the OS service survived the kill.
    world.osRunning = true;
    expect(mod.isBackgroundSending()).toBe(false);

    await mod.syncBackgroundLocationState();

    // Without this the order screen would double-report every fix.
    expect(mod.isBackgroundSending()).toBe(true);
  });
});
