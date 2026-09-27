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
