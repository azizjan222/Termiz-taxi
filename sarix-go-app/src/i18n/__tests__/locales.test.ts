/**
 * Locale key-parity tests.
 *
 * Every supported language must expose the SAME set of translation keys. A missing key
 * in one language silently falls back to Uzbek at runtime (the user sees the wrong
 * language for that string), which is easy to introduce and hard to spot by hand. This
 * test fails the build the moment the locales drift apart.
 *
 * The locale modules are plain objects with no React-Native imports, so they load in a
 * pure jest environment without any native mocks.
 */
import { describe, expect, it } from '@jest/globals';

import en from '../locales/en';
import ru from '../locales/ru';
import uzCyrl from '../locales/uz-cyrl';
import uz from '../locales/uz';

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

const uzKeys = flattenKeys(uz as Dict).sort();

const OTHER_LOCALES: { name: string; dict: Dict }[] = [
  { name: 'uz-cyrl', dict: uzCyrl as Dict },
  { name: 'ru', dict: ru as Dict },
  { name: 'en', dict: en as Dict },
];

describe('i18n locale parity', () => {
  it('has a non-trivial number of keys in the base (uz) locale', () => {
    expect(uzKeys.length).toBeGreaterThan(50);
  });

  it.each(OTHER_LOCALES)('$name has exactly the same keys as uz', ({ dict }) => {
    const keys = flattenKeys(dict).sort();
    const missing = uzKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !uzKeys.includes(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(OTHER_LOCALES)('$name has no empty translation values', ({ dict }) => {
    const empty = flattenKeys(dict).filter((path) => {
      const value = path.split('.').reduce<any>((acc, part) => acc?.[part], dict);
      return typeof value === 'string' && value.trim() === '';
    });
    expect(empty).toEqual([]);
  });
});
