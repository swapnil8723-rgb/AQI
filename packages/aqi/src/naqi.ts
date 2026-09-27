/**
 * CPCB National Air Quality Index (NAQI, 2014).
 *
 * The sub-index is CPCB's formula applied to the published bands:
 *
 *     Ip = (IHi − ILo) / (BHi − BLo) × (Cp − BLo) + ILo
 *
 * with the bands exactly as printed (PM2.5 "31–60" → 51–100 and so on). The
 * printed bands leave one-unit gaps (30 < PM2.5 < 31); a value in a gap is
 * interpolated between the neighbouring edges. The result is continuous,
 * monotone and exactly invertible, and every printed band edge lands in its
 * own category (SO2 381 µg/m³ is Poor, AQI 201, not 200).
 *
 * Invertibility matters: the data.gov.in feed publishes sub-indices, and the
 * pipeline turns them back into concentrations for the pollutant breakdown and
 * the US comparison scale.
 *
 * The Severe band has no printed upper concentration ("250+"). CPCB's
 * calculator continues the Very Poor slope, which is what the last band below
 * does (PM2.5 251–380 → 401–500). The index is capped at 500.
 *
 * Units: µg/m³, except CO in mg/m³. Averaging: 24 h, except CO and O3 (8 h).
 */

import type { NaqiCategory, Pollutant } from './types.ts';
import { NAQI_CATEGORIES } from './types.ts';

type Band = readonly [cLo: number, cHi: number];

/** Printed concentration bands, in category order Good → Severe. Index bands are 0–50, 51–100, 101–200, 201–300, 301–400, 401–500. */
export const NAQI_BANDS: Readonly<Record<Pollutant, readonly Band[]>> = {
  pm10: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430], [431, 510]],
  pm25: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250], [251, 380]],
  no2: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400], [401, 520]],
  o3: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748], [749, 1288]],
  co: [[0, 1.0], [1.1, 2.0], [2.1, 10], [10.1, 17], [17.1, 34], [34.1, 51]],
  so2: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600], [1601, 2400]],
  nh3: [[0, 200], [201, 400], [401, 800], [801, 1200], [1201, 1800], [1801, 2400]],
};

const INDEX_BANDS: readonly Band[] = [[0, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500]];

export const NAQI_MAX = 500;

interface Knots {
  c: number[];
  i: number[];
}

/** Flatten the bands into piecewise-linear knots: (0,0) (30,50) (31,51) (60,100) … */
function knots(p: Pollutant): Knots {
  const c: number[] = [];
  const i: number[] = [];
  NAQI_BANDS[p].forEach(([cLo, cHi], k) => {
    const [iLo, iHi] = INDEX_BANDS[k]!;
    c.push(cLo, cHi);
    i.push(iLo, iHi);
  });
  return { c, i };
}

const KNOTS = Object.fromEntries(
  (Object.keys(NAQI_BANDS) as Pollutant[]).map((p) => [p, knots(p)]),
) as Record<Pollutant, Knots>;

/** Knot concentrations and indices, exported for tests and the calculator widget. */
export function naqiKnots(p: Pollutant): Readonly<Knots> {
  return KNOTS[p];
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function interpolate(xs: number[], ys: number[], x: number): number | null {
  for (let k = 0; k < xs.length - 1; k++) {
    const x0 = xs[k]!;
    const x1 = xs[k + 1]!;
    if (x <= x1) {
      const y0 = ys[k]!;
      const y1 = ys[k + 1]!;
      return x1 === x0 ? y1 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return null;
}

/** Sub-index (unrounded, capped at 500) for a concentration. Null for missing or negative input. */
export function naqiSubIndex(p: Pollutant, concentration: number | null | undefined): number | null {
  if (!isNum(concentration) || concentration < 0) return null;
  const { c, i } = KNOTS[p];
  return interpolate(c, i, concentration) ?? NAQI_MAX;
}

/**
 * Concentration for a sub-index: the exact inverse of naqiSubIndex below 500.
 * At 500 the index is capped, so this returns the Severe band's top edge and
 * callers should read it as "at least".
 */
export function naqiConcentration(p: Pollutant, subIndex: number | null | undefined): number | null {
  if (!isNum(subIndex) || subIndex < 0) return null;
  const { c, i } = KNOTS[p];
  return interpolate(i, c, Math.min(subIndex, NAQI_MAX));
}

/** Category for an AQI value. CPCB bands: 0–50, 51–100, 101–200, 201–300, 301–400, 401–500. */
export function naqiCategory(aqi: number): NaqiCategory {
  const a = Math.round(aqi);
  if (a <= 50) return 'good';
  if (a <= 100) return 'satisfactory';
  if (a <= 200) return 'moderate';
  if (a <= 300) return 'poor';
  if (a <= 400) return 'verypoor';
  return 'severe';
}

/** Colour slot 1–6 shared by both scales (DESIGN.md §2.2). */
export function naqiSlot(aqi: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return (NAQI_CATEGORIES.indexOf(naqiCategory(aqi)) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

/** Lower and upper AQI of the band a value falls in, for "position within band" bars. */
export function naqiBand(aqi: number): [number, number] {
  const [lo, hi] = INDEX_BANDS[naqiSlot(aqi) - 1]!;
  return [lo, hi];
}

export type SubIndices = Partial<Record<Pollutant, number | null | undefined>>;

export interface StationAqi {
  /** Overall AQI (integer, max sub-index), or null when the validity rule fails. */
  aqi: number | null;
  /** Pollutant(s) with the highest sub-index; ties list every tied pollutant. */
  dominant: Pollutant[];
  /** Number of pollutants with a usable sub-index. */
  count: number;
  valid: boolean;
  reason?: 'too-few-pollutants' | 'no-particulate';
}

/**
 * CPCB validity rule: at least three pollutants, one of which is PM2.5 or PM10.
 * Anything less is "Insufficient data" — never a guess.
 */
export function naqiFromSubIndices(sub: SubIndices): StationAqi {
  let max = -1;
  let dominant: Pollutant[] = [];
  let count = 0;
  let hasPm = false;
  for (const [p, raw] of Object.entries(sub) as [Pollutant, number | null | undefined][]) {
    if (!isNum(raw) || raw < 0) continue;
    const v = Math.min(Math.round(raw), NAQI_MAX);
    count++;
    if (p === 'pm25' || p === 'pm10') hasPm = true;
    if (v > max) {
      max = v;
      dominant = [p];
    } else if (v === max) {
      dominant.push(p);
    }
  }
  if (count < 3) return { aqi: null, dominant: [], count, valid: false, reason: 'too-few-pollutants' };
  if (!hasPm) return { aqi: null, dominant: [], count, valid: false, reason: 'no-particulate' };
  return { aqi: max, dominant, count, valid: true };
}

/** Same rule, starting from concentrations. */
export function naqiFromConcentrations(conc: Partial<Record<Pollutant, number | null | undefined>>): StationAqi {
  const sub: SubIndices = {};
  for (const [p, c] of Object.entries(conc) as [Pollutant, number | null | undefined][]) {
    sub[p] = naqiSubIndex(p, c);
  }
  return naqiFromSubIndices(sub);
}
