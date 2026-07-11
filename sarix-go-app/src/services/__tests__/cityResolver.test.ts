import { normalizeCity, resolveRouteCity } from '../cityResolver';

const CITIES = [
  'Termiz',
  'Sariosiyo',
  'Uzun',
  'Denov',
  "Sho'rchi",
  "Jarqo'rg'on",
  "Qumqo'rg'on",
];

describe('normalizeCity', () => {
  it('lowercases the input', () => {
    expect(normalizeCity('TERMIZ')).toBe('termiz');
  });

  it('unifies apostrophe variants to a straight quote', () => {
    expect(normalizeCity('Shoʻrchi')).toBe("sho'rchi");
    expect(normalizeCity('Sho`rchi')).toBe("sho'rchi");
    expect(normalizeCity('Sho’rchi')).toBe("sho'rchi");
  });

  it('handles empty / nullish input safely', () => {
    expect(normalizeCity('')).toBe('');
    // @ts-expect-error intentionally passing undefined
    expect(normalizeCity(undefined)).toBe('');
  });
});

describe('resolveRouteCity', () => {
  it('resolves a district ("... tumani") to its route city', () => {
    const addr = "Telpakchinor qishlog'i, Terakzor mahallasi, Sariosiyo tumani";
    expect(resolveRouteCity(addr, CITIES)).toBe('Sariosiyo');
  });

  it('matches Russian/Cyrillic geocoder spellings', () => {
    expect(resolveRouteCity('улица Ленина, Денау', CITIES)).toBe('Denov');
    expect(resolveRouteCity('Шурчи, Сурхандарья', CITIES)).toBe("Sho'rchi");
    expect(resolveRouteCity('Джаркурган', CITIES)).toBe("Jarqo'rg'on");
  });

  it('matches a direct backend city name anywhere in the address', () => {
    expect(resolveRouteCity('Mustaqillik ko\'chasi, Termiz', CITIES)).toBe('Termiz');
  });

  it('tolerates apostrophe variants in the address', () => {
    expect(resolveRouteCity("Markaz, Qumqo'rg'on tumani", CITIES)).toBe("Qumqo'rg'on");
  });

  it('uses the provided fallback when no district is recognised', () => {
    expect(resolveRouteCity('Some Unknown Place, Tashkent', CITIES, 'Termiz')).toBe(
      'Termiz'
    );
  });

  it('returns the input/fallback for empty address', () => {
    expect(resolveRouteCity('', CITIES, 'Termiz')).toBe('Termiz');
    expect(resolveRouteCity('', CITIES)).toBe('');
  });

  it('falls back to a locality part when no known district and no fallback', () => {
    // 3+ parts -> returns the second-to-last locality segment
    const addr = 'Central Street, Some Village, Faraway Region';
    expect(resolveRouteCity(addr, CITIES)).toBe('Some Village');
  });
});
