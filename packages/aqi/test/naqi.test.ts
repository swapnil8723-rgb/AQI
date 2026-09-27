import { describe, expect, it } from 'vitest';
import {
  NAQI_BANDS,
  POLLUTANTS,
  naqiBand,
  naqiCategory,
  naqiConcentration,
  naqiFromConcentrations,
  naqiFromSubIndices,
  naqiKnots,
  naqiSlot,
  naqiSubIndex,
  type Pollutant,
} from '../src/index.ts';

/**
 * PLAN.md §3.3 table, as published by CPCB (integer concentrations).
 * Each row: the first and last concentration of every category band.
 * The first value of a band must land in that band, the last value too.
 */
const PUBLISHED: Record<Pollutant, [number, number][]> = {
  pm10: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430], [431, 510]],
  pm25: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250], [251, 380]],
  no2: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400], [401, 520]],
  o3: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748], [749, 1288]],
  co: [[0, 1.0], [1.1, 2.0], [2.1, 10], [10.1, 17], [17.1, 34], [34.1, 51]],
  so2: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600], [1601, 2400]],
  nh3: [[0, 200], [201, 400], [401, 800], [801, 1200], [1201, 1800], [1801, 2400]],
};

const CATS = ['good', 'satisfactory', 'moderate', 'poor', 'verypoor', 'severe'] as const;

describe('naqiSubIndex — every published band edge', () => {
  for (const p of POLLUTANTS) {
    PUBLISHED[p].forEach(([lo, hi], band) => {
      it(`${p} ${lo} and ${hi} are ${CATS[band]}`, () => {
        expect(naqiCategory(naqiSubIndex(p, lo)!)).toBe(CATS[band]);
        expect(naqiCategory(naqiSubIndex(p, hi)!)).toBe(CATS[band]);
      });
    });
  }
});

describe('naqiSubIndex — every printed band edge maps to its index edge', () => {
  const INDEX = [[0, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500]];
  for (const p of POLLUTANTS) {
    NAQI_BANDS[p].forEach(([lo, hi], k) => {
      it(`${p} ${lo}→${INDEX[k]![0]}, ${hi}→${INDEX[k]![1]}`, () => {
        expect(naqiSubIndex(p, lo)).toBeCloseTo(INDEX[k]![0]!, 10);
        expect(naqiSubIndex(p, hi)).toBeCloseTo(INDEX[k]![1]!, 10);
      });
    });
  }
  it('the §3.3 table in PLAN.md matches NAQI_BANDS', () => {
    for (const p of POLLUTANTS) expect(NAQI_BANDS[p].map((b) => [...b])).toEqual(PUBLISHED[p]);
  });
});

describe('naqiSubIndex — values inside a one-unit gap are interpolated', () => {
  it('PM2.5 30.5 → 50.5', () => expect(naqiSubIndex('pm25', 30.5)).toBeCloseTo(50.5, 10));
  it('CO 1.05 → 50.5', () => expect(naqiSubIndex('co', 1.05)).toBeCloseTo(50.5, 10));
});

describe('naqiSubIndex — known values', () => {
  // Ip = (IHi − ILo) / (BHi − BLo) × (Cp − BLo) + ILo
  it('PM2.5 45 µg/m³ → 74.66', () => expect(naqiSubIndex('pm25', 45)).toBeCloseTo(51 + (49 / 29) * 14, 10));
  it('PM2.5 150 µg/m³ → 323.26', () => expect(naqiSubIndex('pm25', 150)).toBeCloseTo(301 + (99 / 129) * 29, 10));
  it('PM10 300 → 250', () => expect(naqiSubIndex('pm10', 300)).toBeCloseTo(250, 10));
  it('CO 5 mg/m³ → 137.34', () => expect(naqiSubIndex('co', 5)).toBeCloseTo(101 + (99 / 7.9) * 2.9, 10));
  it('SO2 381 → 201 (Poor), not 200', () => expect(Math.round(naqiSubIndex('so2', 381)!)).toBe(201));
  it('caps at 500', () => expect(naqiSubIndex('pm25', 999)).toBe(500));
  it('rejects negative, NaN, null', () => {
    expect(naqiSubIndex('pm25', -1)).toBeNull();
    expect(naqiSubIndex('pm25', Number.NaN)).toBeNull();
    expect(naqiSubIndex('pm25', null)).toBeNull();
  });
});

describe('naqiConcentration is the inverse of naqiSubIndex', () => {
  for (const p of POLLUTANTS) {
    it(`${p} round-trips across the range`, () => {
      const top = naqiKnots(p).c.at(-1)!;
      for (let i = 0; i <= 200; i++) {
        const c = (top * i) / 200;
        const idx = naqiSubIndex(p, c)!;
        if (idx >= 500) continue;
        expect(naqiConcentration(p, idx)).toBeCloseTo(c, 8);
      }
    });
  }
  it('CO sub-index 28 → 0.56 mg/m³ (the data.gov.in feed reports sub-indices)', () => {
    expect(naqiConcentration('co', 28)).toBeCloseTo(0.56, 10);
  });
});

describe('naqiCategory / slot / band', () => {
  const cases: [number, (typeof CATS)[number], number][] = [
    [0, 'good', 1], [50, 'good', 1], [51, 'satisfactory', 2], [100, 'satisfactory', 2],
    [101, 'moderate', 3], [200, 'moderate', 3], [201, 'poor', 4], [300, 'poor', 4],
    [301, 'verypoor', 5], [400, 'verypoor', 5], [401, 'severe', 6], [500, 'severe', 6],
  ];
  for (const [aqi, cat, slot] of cases) {
    it(`${aqi} → ${cat}`, () => {
      expect(naqiCategory(aqi)).toBe(cat);
      expect(naqiSlot(aqi)).toBe(slot);
    });
  }
  it('bands', () => {
    expect(naqiBand(287)).toEqual([201, 300]);
    expect(naqiBand(50)).toEqual([0, 50]);
  });
});

describe('naqiFromSubIndices — CPCB validity rule', () => {
  it('max sub-index wins and names the dominant pollutant', () => {
    expect(naqiFromSubIndices({ pm25: 287, pm10: 210, no2: 60 })).toEqual({
      aqi: 287, dominant: ['pm25'], count: 3, valid: true,
    });
  });
  it('lists ties', () => {
    expect(naqiFromSubIndices({ pm10: 72, co: 72, no2: 20 }).dominant).toEqual(['pm10', 'co']);
  });
  it('needs three pollutants', () => {
    const r = naqiFromSubIndices({ pm25: 300, pm10: 250 });
    expect(r.valid).toBe(false);
    expect(r.aqi).toBeNull();
    expect(r.reason).toBe('too-few-pollutants');
  });
  it('needs PM2.5 or PM10', () => {
    const r = naqiFromSubIndices({ no2: 50, so2: 10, co: 80, o3: 40 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('no-particulate');
  });
  it('ignores null, negative and NaN readings', () => {
    const r = naqiFromSubIndices({ pm25: 100, pm10: null, no2: -5, so2: Number.NaN, co: 20 });
    expect(r.count).toBe(2);
    expect(r.valid).toBe(false);
  });
  it('rounds and caps each sub-index', () => {
    expect(naqiFromSubIndices({ pm25: 612, pm10: 450.4, no2: 80 }).aqi).toBe(500);
    expect(naqiFromSubIndices({ pm25: 100.5, pm10: 20, no2: 10 }).aqi).toBe(101);
  });
  it('from concentrations', () => {
    const r = naqiFromConcentrations({ pm25: 150, pm10: 300, no2: 90, co: 1.5 });
    expect(r.aqi).toBe(323);
    expect(r.dominant).toEqual(['pm25']);
  });
});
