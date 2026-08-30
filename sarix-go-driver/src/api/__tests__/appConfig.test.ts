/**
 * The maintenance flag gates the entire driver app behind a blocking screen, so the failure
 * behaviour matters more than the happy path: a config call that errors must NEVER be read as
 * "paused". A driver locked out mid-shift by a flaky network is a far worse outcome than one
 * who keeps working for a few minutes into a maintenance window.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockState: { response: unknown; error: Error | null; calls: unknown[] } = {
  response: { maintenance_mode: false },
  error: null,
  calls: [],
};

// `mock` prefix required: babel-plugin-jest-hoist rejects factories that close over
// out-of-scope variables unless the name is recognisably mock-related.
jest.mock('../client', () => ({
  api: {
    get: async (url: string, cfg?: unknown) => {
      mockState.calls.push({ url, cfg });
      if (mockState.error) throw mockState.error;
      return { data: mockState.response };
    },
  },
}));

import { getDriverAppConfig, isAppsMaintenance } from '../appConfig';

beforeEach(() => {
  mockState.response = { maintenance_mode: false };
  mockState.error = null;
  mockState.calls = [];
});

describe('isAppsMaintenance', () => {
  it('reports the paused state the server sends', async () => {
    mockState.response = { maintenance_mode: true };
    expect(await isAppsMaintenance()).toBe(true);
  });

  it('reports not-paused when the server says so', async () => {
    mockState.response = { maintenance_mode: false };
    expect(await isAppsMaintenance()).toBe(false);
  });

  it('does not lock the driver out when the request fails', async () => {
    mockState.error = new Error('offline');
    expect(await isAppsMaintenance()).toBe(false);
  });

  it('does not lock the driver out when the response is malformed', async () => {
    // An HTML error page from a proxy, or an older backend that omits the field.
    mockState.response = null;
    expect(await isAppsMaintenance()).toBe(false);
    mockState.response = {};
    expect(await isAppsMaintenance()).toBe(false);
  });

  it('treats a truthy non-boolean as paused', async () => {
    // Defensive: the endpoint returns a real boolean today, but `!!` is what the code does and
    // "server said something affirmative" should pause rather than be silently ignored.
    mockState.response = { maintenance_mode: 1 };
    expect(await isAppsMaintenance()).toBe(true);
  });
});

describe('getDriverAppConfig', () => {
  it('asks for the driver variant of the config', async () => {
    await getDriverAppConfig();
    // The endpoint serves both apps and branches on this parameter; sending the wrong one
    // would return the passenger app's version gates.
    expect(mockState.calls).toEqual([
      { url: '/api/config', cfg: { params: { app: 'driver' } } },
    ]);
  });
});
