/**
 * Locale key-parity tests for the driver app.
 *
 * The passenger app has had this test for a while; the driver app did not. The dictionaries
 * happened to be in sync when this was written, but nothing was keeping them that way —
 * they are four ~245-key objects in a single 1000-line file, and a missing key silently
 * falls back to Uzbek at runtime, so a Russian driver would just see Uzbek text with no
 * error anywhere.
 *
 * Written deliberately as a STRICT check (no allow-list of known gaps): the dictionaries
 * are complete today, so any drift is a regression introduced by the change under review.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { en, ru, uz, uzCyrl } from '../index';

// The module reads the saved language at import time; the test only needs the dictionaries.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));

type Dict = Record<string, unknown>;

/** Flatten a nested translation object into dot-separated key paths. */
function flattenKeys(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Dict, path)
      : [path];
  });
}

const TRANSLATIONS: [string, Dict][] = [
  ['ru', ru as Dict],
  ['en', en as Dict],
  ['uz-cyrl', uzCyrl as Dict],
];

const uzKeys = flattenKeys(uz as Dict);

describe('driver locale parity', () => {
  it('the Uzbek baseline has no duplicate keys', () => {
    // Duplicated keys in an object literal are legal JS — the last one silently wins — so
    // a copy-paste can quietly drop a translation without any tooling complaining.
    expect(uzKeys).toEqual([...new Set(uzKeys)]);
  });

  it.each(TRANSLATIONS)('%s exposes exactly the Uzbek key set', (_lang, dict) => {
    expect(flattenKeys(dict).sort()).toEqual([...uzKeys].sort());
  });

  it.each(TRANSLATIONS)('%s has no duplicate keys', (_lang, dict) => {
    const keys = flattenKeys(dict);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it.each(TRANSLATIONS)('%s leaves no value empty', (_lang, dict) => {
    // An empty string renders as nothing at all, which looks like a layout bug rather
    // than a missing translation.
    const empties = Object.entries(dict).flatMap(([ns, block]) =>
      block && typeof block === 'object'
        ? Object.entries(block as Dict)
            .filter(([, v]) => typeof v === 'string' && !v.trim())
            .map(([k]) => `${ns}.${k}`)
        : []
    );
    expect(empties).toEqual([]);
  });
});
