import { describe, expect, it } from '@jest/globals';

import { compareVersions } from '../app-config';

// compareVersions drives the force-update gate (if current < min_version -> block the
// app). A wrong result here would either lock users out on a valid version or fail to
// enforce a required update, so the ordering rules are pinned down here.
describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('detects a lower version (negative)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });

  it('detects a higher version (positive)', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
    expect(compareVersions('1', '1.0.1')).toBeLessThan(0);
  });

  it('is not fooled by lexical comparison (10 > 9)', () => {
    // A naive string compare would order "1.9.0" after "1.10.0"; numeric must not.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('blocks when current is below min_version', () => {
    // Real gate: force update when compareVersions(current, min) < 0.
    const current = '1.4.0';
    const min = '1.5.0';
    expect(compareVersions(current, min) < 0).toBe(true);
  });

  it('allows when current meets or exceeds min_version', () => {
    expect(compareVersions('1.5.0', '1.5.0') < 0).toBe(false);
    expect(compareVersions('1.6.0', '1.5.0') < 0).toBe(false);
  });
});
