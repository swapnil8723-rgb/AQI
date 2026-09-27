import { describe, expect, it } from 'vitest';
import { buildReplay, coordLookup } from '../src/index.ts';

const coords = [
  { city: 'Delhi', state: 'Delhi', lat: 28.63, lon: 77.17 },
  { city: 'Aurangabad', state: 'Maharashtra', lat: 19.86, lon: 75.32 },
  { city: 'Aurangabad', state: 'Bihar', lat: 24.75, lon: 84.37 },
  { city: 'Greater Noida', state: 'Uttar Pradesh', lat: 28.51, lon: 77.47 },
];

describe('coordLookup', () => {
  const at = coordLookup(coords);
  it('matches bulletin spellings to feed cities', () => {
    expect(at('Delhi')).toEqual({ la: 28.63, lo: 77.17 });
    expect(at('Greater noida')).toEqual({ la: 28.51, lo: 77.47 });
  });
  it('uses the printed state to split duplicate names', () => {
    expect(at('Aurangabad (Maharashtra)')).toEqual({ la: 19.86, lo: 75.32 });
    expect(at('Aurangabad (Bihar)')).toEqual({ la: 24.75, lo: 84.37 });
  });
  it('refuses an ambiguous bare name rather than guessing', () => {
    expect(at('Aurangabad')).toBeNull();
    expect(at('Atlantis')).toBeNull();
  });
});

describe('buildReplay', () => {
  it('one row per city, a value (or null) per date, launch slugs kept', () => {
    const r = buildReplay(
      ['2025-10-20', '2025-10-21'],
      {
        '2025-10-20': [{ city: 'Delhi', aqi: 345 }, { city: 'Aurangabad (Maharashtra)', aqi: 120 }],
        '2025-10-21': [{ city: 'Delhi', aqi: 351 }, { city: 'Atlantis', aqi: 1 }],
      },
      coordLookup(coords),
      { date: '2025-10-20', label: 'Diwali' },
    );
    expect(r.dates).toEqual(['2025-10-20', '2025-10-21']);
    expect(r.mark).toEqual({ date: '2025-10-20', label: 'Diwali' });
    expect(r.cities.map((c) => [c.n, c.s, c.v])).toEqual([
      ['Aurangabad', null, [120, null]],
      ['Delhi', 'delhi', [345, 351]],
    ]);
  });
});
