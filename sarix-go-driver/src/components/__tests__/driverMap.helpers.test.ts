import { describe, expect, it } from '@jest/globals';

import {
  isFiniteCoord,
  haversineMeters,
  formatDistance,
  formatEta,
  navTextFor,
  shortenAddress,
  buildNavCandidates,
  buildNavCandidatesByText,
  deriveTarget,
  deriveMarkers,
  deriveInitialCenter,
  ETA_AVG_SPEED_KMH,
  type Coords,
} from '../driverMap.helpers';

describe('isFiniteCoord', () => {
  it('accepts finite numbers', () => {
    expect(isFiniteCoord(37.2, 67.3)).toBe(true);
  });
  it('rejects NaN / Infinity / non-numbers', () => {
    expect(isFiniteCoord(NaN, 67.3)).toBe(false);
    expect(isFiniteCoord(37.2, Infinity)).toBe(false);
    expect(isFiniteCoord(null, 67.3)).toBe(false);
    expect(isFiniteCoord('37', 67)).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p: Coords = { lat: 37.224, lon: 67.278 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('computes a known distance within tolerance', () => {
    // Termiz -> Denov is roughly 75-95 km; assert a sane order of magnitude.
    const termiz: Coords = { lat: 37.224, lon: 67.278 };
    const denov: Coords = { lat: 38.267, lon: 67.897 };
    const meters = haversineMeters(termiz, denov);
    expect(meters).toBeGreaterThan(100_000);
    expect(meters).toBeLessThan(140_000);
  });

  it('returns NaN sentinel for null / invalid input', () => {
    expect(Number.isNaN(haversineMeters(null, { lat: 1, lon: 1 }))).toBe(true);
    expect(Number.isNaN(haversineMeters({ lat: NaN, lon: 1 }, { lat: 1, lon: 1 }))).toBe(true);
  });
});

describe('formatDistance', () => {
  it('formats sub-kilometer distances in meters', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(0)).toBe('0 m');
  });
  it('formats kilometer distances with one decimal', () => {
    expect(formatDistance(3200)).toBe('3.2 km');
  });
  it('returns the safe fallback for invalid input', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
  });
});

describe('formatEta', () => {
  it('computes minutes from distance and speed', () => {
    // 15 km at 30 km/h = 30 minutes
    expect(formatEta(15000, 30)).toBe('30 daqiqa');
    expect(formatEta(0, ETA_AVG_SPEED_KMH)).toBe('0 daqiqa');
  });
  it('returns the safe fallback for invalid input', () => {
    expect(formatEta(NaN, 30)).toBe('—');
    expect(formatEta(1000, 0)).toBe('—');
  });
});

describe('navTextFor', () => {
  it('joins address and city when distinct', () => {
    expect(navTextFor("Mustaqillik ko'chasi 306", 'Denov')).toBe(
      "Mustaqillik ko'chasi 306, Denov"
    );
  });
  it('does not duplicate the city when already present', () => {
    expect(navTextFor('Denov markaz', 'Denov')).toBe('Denov markaz');
  });
  it('falls back to whichever value is present', () => {
    expect(navTextFor('', 'Denov')).toBe('Denov');
    expect(navTextFor('Some street', '')).toBe('Some street');
    expect(navTextFor(null, null)).toBe('');
  });
});

describe('shortenAddress', () => {
  it('keeps the last two meaningful segments, dropping country/region/district', () => {
    const full =
      "O'zbekiston, Surxondaryo viloyati, Denov tumani, Denov, Mustaqillik ko'chasi, 306";
    expect(shortenAddress(full)).toBe("Mustaqillik ko'chasi, 306");
  });
  it('falls back to city then raw when empty', () => {
    expect(shortenAddress('', 'Denov')).toBe('Denov');
    expect(shortenAddress(null, null)).toBe('');
  });
});

describe('buildNavCandidates', () => {
  it('returns only Yandex targets embedding the coordinates', () => {
    const urls = buildNavCandidates(37.2, 67.3, 'android');
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => u.toLowerCase().includes('yandex'))).toBe(true);
    expect(urls[0]).toContain('37.2');
    expect(urls[0]).toContain('67.3');
  });
});

describe('buildNavCandidatesByText', () => {
  it('URL-encodes the query into Yandex search links', () => {
    const urls = buildNavCandidatesByText('Denov markaz');
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('Denov%20markaz');
  });
  it('returns an empty list for a blank query', () => {
    expect(buildNavCandidatesByText('   ')).toEqual([]);
  });
});

describe('deriveTarget', () => {
  const base = {
    from_lat: 37.2,
    from_lon: 67.3,
    to_lat: 38.2,
    to_lon: 67.9,
  };
  it('targets pickup before the passenger boards', () => {
    const order = { ...base, status: 'accepted' } as any;
    expect(deriveTarget(order)).toEqual({ lat: 37.2, lon: 67.3 });
  });
  it('targets destination once in progress', () => {
    const order = { ...base, status: 'in_progress' } as any;
    expect(deriveTarget(order)).toEqual({ lat: 38.2, lon: 67.9 });
  });
  it('returns null for a null order', () => {
    expect(deriveTarget(null)).toBeNull();
  });
});

describe('deriveMarkers', () => {
  it('produces distinct pickup and driver markers', () => {
    const markers = deriveMarkers({ lat: 1, lon: 2 }, { lat: 3, lon: 4 });
    expect(markers.map((m) => m.id)).toEqual(['pickup', 'driver']);
  });
  it('omits a marker whose coords are null', () => {
    expect(deriveMarkers(null, { lat: 3, lon: 4 })).toHaveLength(1);
    expect(deriveMarkers(null, null)).toEqual([]);
  });
});

describe('deriveInitialCenter', () => {
  it('prefers pickup, then driver, then the Termiz default', () => {
    expect(deriveInitialCenter({ lat: 1, lon: 2 }, { lat: 3, lon: 4 })).toEqual({ lat: 1, lon: 2 });
    expect(deriveInitialCenter(null, { lat: 3, lon: 4 })).toEqual({ lat: 3, lon: 4 });
    const def = deriveInitialCenter(null, null);
    expect(def.lat).toBeCloseTo(37.224);
    expect(def.lon).toBeCloseTo(67.278);
  });
});
