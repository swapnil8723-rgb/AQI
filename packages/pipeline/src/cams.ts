/**
 * CAMS via Open-Meteo — the live estimate while CPCB's machine-readable feed
 * is down.
 *
 * Facts established on 30 Sep 2026:
 * - data.gov.in returns 502/504 and then refuses the connection outright; its
 *   own catalog endpoint (`/lists`) and its own resource page fail too, so it
 *   is the platform, not our key. CPCB's legacy JSON endpoints (`AQI_India`,
 *   `aqi_dashboard/aqi_all_Parameters`, `caaqms_viewdata_v2`) all answer 404,
 *   and the replacement Central Control Room app is an obfuscated SPA behind
 *   an OAuth token.
 * - Every free redistributor of CPCB went down with it: WAQI's Indian stations
 *   last reported 2026-06-23, and OpenAQ shows no Indian locations.
 * - CPCB's daily 4 PM bulletin PDF is still published (bulletin.ts), so the
 *   *official* number is unaffected. Only the hourly live estimate moves here.
 *
 * What this is: ECMWF's Copernicus Atmosphere Monitoring Service global
 * forecast, an ~11 km model grid — **not** a measurement. It has no stations,
 * so a CAMS bundle carries city values only and `CityNow.source` is 'cams'.
 * Never present it as a station reading (AGENTS.md rule 1).
 *
 * Method: CPCB's own averaging is applied to the model's hourly
 * concentrations — 24 h means, 8 h for CO and O3 (POLLUTANT_WINDOW) — then
 * CPCB's sub-index and validity rule, so the arithmetic downstream is
 * unchanged. Open-Meteo reports CO in µg/m³ where NAQI's band is mg/m³.
 *
 * One request carries every city: 280 coordinates answered in ~850 ms, so the
 * hourly job costs ~24 calls a day against a 10,000/day free allowance.
 *
 * **Licence:** the data is CC BY 4.0, but Open-Meteo's free tier is
 * non-commercial and its terms name "websites or apps that ... display
 * advertisements" as needing a paid plan. Volume is not the problem; the ad
 * slots in PLAN.md's monetisation ladder are. Move to a paid plan (or
 * self-host their API) before switching ads on.
 */

import { POLLUTANT_WINDOW, naqiConcentration, naqiFromSubIndices, naqiSubIndex, usAqi, type Pollutant } from '@saans/aqi';
import type { CityNow } from './types.ts';

export const CAMS_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export const CAMS_SOURCE = 'Copernicus Atmosphere Monitoring Service (CAMS) global forecast via Open-Meteo, CC BY 4.0';

/** Open-Meteo's name for each NAQI pollutant. CAMS carries no NH3. */
export const CAMS_VARS: Readonly<Partial<Record<Pollutant, string>>> = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  no2: 'nitrogen_dioxide',
  so2: 'sulphur_dioxide',
  o3: 'ozone',
  co: 'carbon_monoxide',
};

/** Open-Meteo reports every gas in µg/m³; NAQI's CO band is mg/m³. */
const SCALE: Readonly<Partial<Record<Pollutant, number>>> = { co: 1 / 1000 };

/** Fraction of a pollutant's averaging window that must be present to use it. */
const MIN_COVERAGE = 0.75;

const HOUR = 3600_000;

export interface CamsSite {
  /** Launch-city slug, or null for a map-only city. */
  slug: string | null;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface CamsCity extends CamsSite {
  /** Newest model hour used, ISO UTC. */
  at: string;
  /** Window mean per pollutant (µg/m³; CO mg/m³). */
  conc: Partial<Record<Pollutant, number>>;
  /** Hours averaged per pollutant. */
  hours: Partial<Record<Pollutant, number>>;
}

const POLLUTANTS_ = Object.keys(CAMS_VARS) as Pollutant[];

export function camsUrl(sites: readonly CamsSite[], pastDays = 2): string {
  const q = new URLSearchParams({
    latitude: sites.map((s) => s.lat.toFixed(4)).join(','),
    longitude: sites.map((s) => s.lon.toFixed(4)).join(','),
    hourly: POLLUTANTS_.map((p) => CAMS_VARS[p]!).join(','),
    past_days: String(pastDays),
    forecast_days: '1',
    timezone: 'UTC',
  });
  return `${CAMS_URL}?${q}`;
}

interface CamsBlock {
  hourly?: Record<string, unknown>;
}

function series(block: CamsBlock, key: string): (number | null)[] {
  const v = block.hourly?.[key];
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
}

/**
 * Trailing mean over the pollutant's NAQI window, ending at the newest model
 * hour at or before `nowMs`. Null unless MIN_COVERAGE of the window is
 * present — a partial window is not an average.
 */
function windowMean(times: number[], values: (number | null)[], end: number, window: number): { mean: number; n: number } | null {
  const from = end - (window - 1) * HOUR;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (!Number.isFinite(t) || t < from || t > end) continue;
    const v = values[i];
    if (v === null || v === undefined) continue;
    sum += v;
    n++;
  }
  if (n < Math.ceil(window * MIN_COVERAGE)) return null;
  return { mean: sum / n, n };
}

/** Parse one Open-Meteo response into per-city window means. Never throws on a bad block. */
export function parseCams(sites: readonly CamsSite[], body: unknown, nowMs: number = Date.now()): CamsCity[] {
  const blocks: CamsBlock[] = Array.isArray(body) ? (body as CamsBlock[]) : [body as CamsBlock];
  const out: CamsCity[] = [];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    const block = blocks[i];
    const rawTimes = block?.hourly?.['time'];
    if (!Array.isArray(rawTimes)) continue;
    // Open-Meteo prints "2026-09-30T13:00" when timezone=UTC.
    const times = rawTimes.map((t) => (typeof t === 'string' ? Date.parse(`${t}:00Z`) : NaN));

    // The response runs into the forecast; the estimate uses model hours up to now only.
    let end = -Infinity;
    for (const t of times) if (Number.isFinite(t) && t <= nowMs && t > end) end = t;
    if (!Number.isFinite(end)) continue;

    const conc: CamsCity['conc'] = {};
    const hours: CamsCity['hours'] = {};
    for (const p of POLLUTANTS_) {
      const m = windowMean(times, series(block!, CAMS_VARS[p]!), end, POLLUTANT_WINDOW[p]);
      if (!m) continue;
      conc[p] = m.mean * (SCALE[p] ?? 1);
      hours[p] = m.n;
    }
    out.push({ ...site, at: new Date(end).toISOString(), conc, hours });
  }
  return out;
}

export interface FetchCamsOptions {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  pastDays?: number;
  now?: number;
  /** Coordinates per request. One call carries all 280 cities; chunking is a guard on URL length. */
  chunk?: number;
}

/** Fetch every site's window means. */
export async function fetchCams(sites: readonly CamsSite[], opts: FetchCamsOptions = {}): Promise<CamsCity[]> {
  const f = opts.fetchImpl ?? fetch;
  const size = opts.chunk ?? 150;
  const out: CamsCity[] = [];
  for (let i = 0; i < sites.length; i += size) {
    const batch = sites.slice(i, i + size);
    const res = await f(camsUrl(batch, opts.pastDays), {
      headers: { accept: 'application/json', 'user-agent': opts.userAgent ?? 'saans-ingest' },
    });
    if (!res.ok) throw new Error(`cams: HTTP ${res.status} for ${batch.length} sites at ${i}`);
    out.push(...parseCams(batch, await res.json(), opts.now ?? Date.now()));
  }
  return out;
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

// ─── Calibration against CPCB's bulletin ─────────────────────────────────
//
// Raw CAMS runs hot over India — a known dust bias in the global model's PM10.
// Measured against the 29 Sep 2026 bulletin across the 25 launch cities, the
// uncorrected estimate was 2–5× CPCB (Delhi 150 vs 71) and landed within 10%
// on **none** of them. A per-city factor learned from recent bulletins takes
// that to roughly a third within 10% and four fifths within 25%.
//
// It is a correction, not a measurement. The page must say so, and /about must
// publish the real error band rather than the station-era accuracy claim.

/** Multiplier per launch-city slug, applied to the model's concentrations. */
export type CamsCalibration = Record<string, number>;

export interface CalibrationPair {
  slug: string;
  /** CPCB's bulletin AQI that day. */
  cpcb: number;
  /** Our uncalibrated CAMS estimate at 16:00 IST the same day. */
  ours: number;
}

/** Bulletin days needed before a city gets its own factor. */
export const MIN_CALIBRATION_DAYS = 3;
/** A correction this large means something else is wrong; don't chase it. */
const CLAMP: readonly [number, number] = [0.2, 2.5];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const clamp = (x: number) => Math.min(CLAMP[1], Math.max(CLAMP[0], x));

/**
 * Learn a per-city correction from (bulletin, our estimate) pairs — the same
 * reconciliation the archive already stores. Cities with too few days fall
 * back to the median correction across all cities, so a new city is never
 * left with the raw 2× reading.
 */
export function camsCalibration(pairs: readonly CalibrationPair[]): CamsCalibration {
  const by = new Map<string, number[]>();
  for (const p of pairs) {
    if (!(p.cpcb > 0) || !(p.ours > 0)) continue;
    let a = by.get(p.slug);
    if (!a) by.set(p.slug, (a = []));
    a.push(p.cpcb / p.ours);
  }
  const out: CamsCalibration = {};
  const settled: number[] = [];
  for (const [slug, rs] of by) {
    if (rs.length < MIN_CALIBRATION_DAYS) continue;
    const k = clamp(median(rs));
    out[slug] = round(k, 3);
    settled.push(k);
  }
  if (settled.length) {
    const fallback = round(clamp(median(settled)), 3);
    for (const slug of by.keys()) out[slug] ??= fallback;
    out['*'] = fallback;
  }
  return out;
}

/**
 * The factor for a city, or the national fallback. The correction is applied
 * to the **sub-indices**, not the concentrations: the AQI is the maximum
 * sub-index, so scaling every sub-index by k scales the headline by exactly k
 * — which is the scale the factor was learned on. Scaling concentrations
 * instead would push the value along a different slope of the band curve
 * (Delhi: 51 against CPCB's 71, versus 62 the right way).
 */
export function camsFactor(cal: CamsCalibration | undefined, slug: string | null): number {
  const k = (slug ? cal?.[slug] : undefined) ?? cal?.['*'];
  return typeof k === 'number' && k > 0 ? k : 1;
}

/**
 * A city's live estimate from the model. Same sub-index, validity rule and
 * rounding as the station path; `valid`/`total` are 0 because CAMS has no
 * stations, and `source` marks the number as modelled.
 */
export function camsCityNow(c: CamsCity, cal?: CamsCalibration): CityNow | null {
  const k = camsFactor(cal, c.slug);

  // Sub-index per pollutant, corrected, then CPCB's validity rule on top.
  const sub: Partial<Record<Pollutant, number>> = {};
  for (const [p, v] of Object.entries(c.conc) as [Pollutant, number][]) {
    const i = naqiSubIndex(p, v);
    if (i !== null) sub[p] = i * k;
  }
  const { aqi, dominant, valid } = naqiFromSubIndices(sub);
  if (!valid || aqi === null) return null;

  const pollutants: CityNow['pollutants'] = {};
  for (const [p, i] of Object.entries(sub) as [Pollutant, number][]) {
    pollutants[p] = { i: Math.round(i), c: round(naqiConcentration(p, i) ?? 0, p === 'co' ? 2 : 1), n: c.hours[p] ?? 0 };
  }
  // The US scale takes concentrations, so correct those the same way.
  const usConc = (p: Pollutant) => (sub[p] === undefined ? null : naqiConcentration(p, sub[p]!));
  const us = usAqi({ pm25: usConc('pm25'), pm10: usConc('pm10'), o3: usConc('o3'), co: usConc('co') });

  return {
    aqi,
    min: aqi,
    max: aqi,
    valid: 0,
    total: 0,
    dominant,
    us: us?.aqi ?? null,
    at: c.at,
    pollutants,
    excluded: 0,
    source: 'cams',
  };
}
