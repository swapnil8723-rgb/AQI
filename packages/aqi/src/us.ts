/**
 * US EPA AQI, for comparison only (40 CFR Part 58 App. G, with the PM2.5
 * revision effective 6 May 2024: Good ends at 9.0 µg/m³ and the two Hazardous
 * bands are merged into 301–500).
 *
 * Only pollutants whose averaging period matches what CPCB gives us are used:
 * PM2.5 and PM10 (24 h), O3 and CO (8 h). EPA scores NO2 and SO2 on 1-hour
 * values; CPCB's are 24-hour averages, so scoring them on the US scale would
 * be wrong and they are left out on purpose.
 *
 * Concentrations are truncated (not rounded) before lookup, as EPA specifies.
 */

import type { Pollutant, UsCategory } from './types.ts';
import { US_CATEGORIES } from './types.ts';

type Band = readonly [cLo: number, cHi: number, iLo: number, iHi: number];

const PM25: readonly Band[] = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

const PM10: readonly Band[] = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
];

/** 8-hour O3 in ppm. EPA has no 8-hour value above 0.200 ppm (that range uses 1-hour O3). */
const O3_8H: readonly Band[] = [
  [0.0, 0.054, 0, 50],
  [0.055, 0.07, 51, 100],
  [0.071, 0.085, 101, 150],
  [0.086, 0.105, 151, 200],
  [0.106, 0.2, 201, 300],
];

/** 8-hour CO in ppm. */
const CO_8H: readonly Band[] = [
  [0.0, 4.4, 0, 50],
  [4.5, 9.4, 51, 100],
  [9.5, 12.4, 101, 150],
  [12.5, 15.4, 151, 200],
  [15.5, 30.4, 201, 300],
  [30.5, 50.4, 301, 500],
];

/** Molar volume at 25 °C, 1 atm (EPA reference conditions). */
const MOLAR_VOLUME = 24.45;
const MW_O3 = 48.0;
const MW_CO = 28.01;

export const O3_UGM3_TO_PPM = MOLAR_VOLUME / MW_O3 / 1000;
export const CO_MGM3_TO_PPM = MOLAR_VOLUME / MW_CO;

function truncate(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // The epsilon absorbs binary noise such as 35.4 * 10 = 353.99999999999994.
  return Math.floor(value * f + 1e-9) / f;
}

function lookup(bands: readonly Band[], c: number, capIndex: number): number {
  for (const [cLo, cHi, iLo, iHi] of bands) {
    if (c <= cHi) {
      if (c < cLo) {
        // Falls in a gap between truncated bands (cannot happen after truncation) — use the lower band's top.
        return iLo;
      }
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo);
    }
  }
  return capIndex;
}

export interface UsInputs {
  /** µg/m³, 24 h */
  pm25?: number | null;
  /** µg/m³, 24 h */
  pm10?: number | null;
  /** µg/m³, 8 h */
  o3?: number | null;
  /** mg/m³, 8 h */
  co?: number | null;
}

export type UsPollutant = 'pm25' | 'pm10' | 'o3' | 'co';

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

export function usSubIndex(p: UsPollutant, c: number | null | undefined): number | null {
  if (!ok(c)) return null;
  switch (p) {
    case 'pm25':
      return lookup(PM25, truncate(c, 1), 500);
    case 'pm10':
      return lookup(PM10, truncate(c, 0), 500);
    case 'o3':
      return lookup(O3_8H, truncate(c * O3_UGM3_TO_PPM, 3), 300);
    case 'co':
      return lookup(CO_8H, truncate(c * CO_MGM3_TO_PPM, 1), 500);
  }
}

export interface UsAqi {
  aqi: number;
  dominant: UsPollutant;
}

/** Overall US AQI (max sub-index). Null unless PM2.5 or PM10 is present. */
export function usAqi(inputs: UsInputs): UsAqi | null {
  if (!ok(inputs.pm25) && !ok(inputs.pm10)) return null;
  let best: UsAqi | null = null;
  for (const p of ['pm25', 'pm10', 'o3', 'co'] as const) {
    const i = usSubIndex(p, inputs[p]);
    if (i === null) continue;
    if (!best || i > best.aqi) best = { aqi: i, dominant: p };
  }
  return best;
}

export function usCategory(aqi: number): UsCategory {
  const a = Math.round(aqi);
  if (a <= 50) return 'good';
  if (a <= 100) return 'moderate';
  if (a <= 150) return 'usg';
  if (a <= 200) return 'unhealthy';
  if (a <= 300) return 'veryunhealthy';
  return 'hazardous';
}

export function usSlot(aqi: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return (US_CATEGORIES.indexOf(usCategory(aqi)) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export const US_POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'o3', 'co'];

// ─── Hourly inputs (the global estimate, packages/pipeline/src/global.ts) ──────
//
// The CPCB path above only has 24-hour and 8-hour averages, so it scores four
// pollutants. A model gives every hour, which lets the global estimate do what
// AirNow does: NowCast for particles, and EPA's 1-hour breakpoints for NO2 and
// SO2.

/** 1-hour NO2 in ppb. */
const NO2_1H: readonly Band[] = [
  [0, 53, 0, 50],
  [54, 100, 51, 100],
  [101, 360, 101, 150],
  [361, 649, 151, 200],
  [650, 1249, 201, 300],
  [1250, 2049, 301, 500],
];

/**
 * 1-hour SO2 in ppb. EPA scores 1-hour SO2 only up to 304 ppb (AQI 200); above
 * that it switches to the 24-hour average, which an hourly value cannot give,
 * so the sub-index stops at 200.
 */
const SO2_1H: readonly Band[] = [
  [0, 35, 0, 50],
  [36, 75, 51, 100],
  [76, 185, 101, 150],
  [186, 304, 151, 200],
];

const MW_NO2 = 46.01;
const MW_SO2 = 64.07;
export const NO2_UGM3_TO_PPB = MOLAR_VOLUME / MW_NO2;
export const SO2_UGM3_TO_PPB = MOLAR_VOLUME / MW_SO2;

/** 1-hour NO2 sub-index from µg/m³. */
export function usNo2SubIndex(ugm3: number | null | undefined): number | null {
  if (!ok(ugm3)) return null;
  return lookup(NO2_1H, truncate(ugm3 * NO2_UGM3_TO_PPB, 0), 500);
}

/** 1-hour SO2 sub-index from µg/m³ (capped at 200, see SO2_1H). */
export function usSo2SubIndex(ugm3: number | null | undefined): number | null {
  if (!ok(ugm3)) return null;
  return lookup(SO2_1H, truncate(ugm3 * SO2_UGM3_TO_PPB, 0), 200);
}

/**
 * EPA's NowCast for PM2.5 and PM10: a weighted mean of the last 12 hours that
 * follows a rising or falling trend faster than a 24-hour average.
 *
 * `hours[0]` is the most recent hour, `hours[11]` eleven hours earlier; null
 * marks a missing hour. Needs two of the three most recent hours. The weight
 * factor is min/max over the available hours, floored at 0.5.
 */
export function nowcast(hours: readonly (number | null | undefined)[]): number | null {
  const last12 = hours.slice(0, 12);
  if (last12.slice(0, 3).filter(ok).length < 2) return null;
  const vals = last12.filter(ok);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const w = max > 0 ? Math.max(min / max, 0.5) : 1;
  let num = 0;
  let den = 0;
  last12.forEach((c, i) => {
    if (!ok(c)) return;
    num += w ** i * c;
    den += w ** i;
  });
  return den > 0 ? num / den : null;
}

export type UsHourlyPollutant = UsPollutant | 'no2' | 'so2';

export interface UsHourlyInputs extends UsInputs {
  /** µg/m³, 1 h */
  no2?: number | null;
  /** µg/m³, 1 h */
  so2?: number | null;
}

export interface UsHourlyAqi {
  aqi: number;
  dominant: UsHourlyPollutant;
  /** Sub-index per pollutant that could be scored. */
  sub: Partial<Record<UsHourlyPollutant, number>>;
}

/**
 * Overall AQI from already-averaged inputs: NowCast PM, 8-hour O3 and CO,
 * 1-hour NO2 and SO2. Null unless PM2.5 or PM10 is present.
 */
export function usAqiHourly(inputs: UsHourlyInputs): UsHourlyAqi | null {
  if (!ok(inputs.pm25) && !ok(inputs.pm10)) return null;
  const sub: UsHourlyAqi['sub'] = {};
  for (const p of ['pm25', 'pm10', 'o3', 'co'] as const) {
    const i = usSubIndex(p, inputs[p]);
    if (i !== null) sub[p] = i;
  }
  const no2 = usNo2SubIndex(inputs.no2);
  if (no2 !== null) sub.no2 = no2;
  const so2 = usSo2SubIndex(inputs.so2);
  if (so2 !== null) sub.so2 = so2;
  let best: UsHourlyAqi | null = null;
  for (const [p, i] of Object.entries(sub) as [UsHourlyPollutant, number][]) {
    if (!best || i > best.aqi) best = { aqi: i, dominant: p, sub };
  }
  return best;
}
