/**
 * The global estimate: CAMS via Open-Meteo for every city in WORLD_CITIES,
 * scored on the US EPA AQI the way AirNow scores its own monitors.
 *
 * What it is: ECMWF's Copernicus Atmosphere Monitoring Service forecast
 * (CAMS Europe at ~11 km over Europe, CAMS global at ~45 km elsewhere), a
 * model, **not** a measurement. Every page that shows it says so.
 *
 * Method, per hour:
 * - PM2.5 and PM10: EPA NowCast over the trailing 12 hours.
 * - O3 and CO: trailing 8-hour mean (75% of the window present).
 * - NO2 and SO2: the hour itself, on EPA's 1-hour breakpoints.
 * - AQI = the highest sub-index; PM2.5 or PM10 must be present.
 *
 * One bundle holds 24 hours of the past and 48 of the forecast for every
 * city, so a page can pick the current hour at render time and stays right
 * between refreshes. CAMS issues two runs a day, so a refresh every six hours
 * never misses one: ~550 cities × 4 = ~2,200 Open-Meteo calls a day.
 *
 * Licence: CC BY 4.0 data. Open-Meteo's free tier is non-commercial; take a
 * paid plan (or self-host) before ads go on (see cams.ts).
 */
import { nowcast, usAqiHourly, type UsHourlyPollutant } from '@saans/aqi';
import { WORLD_CITIES, worldKey, type WorldCity } from '@saans/data';
import { CAMS_URL } from './cams.ts';

export const GLOBAL_KEY = 'global:v1';

export const GLOBAL_SOURCE =
  'Copernicus Atmosphere Monitoring Service (CAMS) forecast via Open-Meteo, CC BY 4.0; cities from GeoNames, CC BY 4.0';

const H = 3600_000;
/** Hours of the past and of the forecast kept per city. */
export const PAST_HOURS = 24;
export const FUTURE_HOURS = 48;

export const GLOBAL_VARS = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  o3: 'ozone',
  no2: 'nitrogen_dioxide',
  so2: 'sulphur_dioxide',
  co: 'carbon_monoxide',
} as const;
export type GlobalPollutant = keyof typeof GLOBAL_VARS;
const POLLS = Object.keys(GLOBAL_VARS) as GlobalPollutant[];

/** One letter per hour for the dominant pollutant; '-' when the hour has no AQI. */
export const DOMINANT_CODE: Readonly<Record<UsHourlyPollutant, string>> = { pm25: 'p', pm10: 'q', o3: 'o', no2: 'n', so2: 's', co: 'c' };
const CODE_POLLUTANT = Object.fromEntries(Object.entries(DOMINANT_CODE).map(([p, c]) => [c, p])) as Record<string, UsHourlyPollutant>;

export interface GlobalCity {
  /** US AQI per hour from the bundle's t0. */
  a: (number | null)[];
  /** Dominant pollutant per hour, one DOMINANT_CODE letter each. */
  d: string;
  /** Hourly concentrations, µg/m³ (CO too: divide by 1000 for mg/m³). */
  c: Record<GlobalPollutant, (number | null)[]>;
}

export interface GlobalBundle {
  v: 1;
  generatedAt: string;
  source: string;
  /** First hour of every series, ISO UTC. */
  t0: string;
  /** Hours per series. */
  n: number;
  cities: Record<string, GlobalCity>;
}

export function globalUrl(sites: readonly Pick<WorldCity, 'lat' | 'lon'>[], pastDays = 2, forecastDays = 3): string {
  const q = new URLSearchParams({
    latitude: sites.map((s) => s.lat.toFixed(4)).join(','),
    longitude: sites.map((s) => s.lon.toFixed(4)).join(','),
    hourly: POLLS.map((p) => GLOBAL_VARS[p]).join(','),
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    timezone: 'UTC',
  });
  return `${CAMS_URL}?${q}`;
}

interface Block {
  hourly?: Record<string, unknown>;
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);

function mean(xs: (number | null)[], need: number): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length >= need ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const round = (x: number | null, d = 0) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Score one Open-Meteo block on the hours t0, t0+1h, … t0+(n−1)h. Hours the
 * block does not cover come out null; nothing throws on a bad block.
 */
export function scoreBlock(block: Block | undefined, t0: number, n: number): GlobalCity {
  const out: GlobalCity = { a: [], d: '', c: { pm25: [], pm10: [], o3: [], no2: [], so2: [], co: [] } };
  const times = block?.hourly?.['time'];
  const idx = new Map<number, number>();
  if (Array.isArray(times)) times.forEach((t, i) => typeof t === 'string' && idx.set(Date.parse(`${t}:00Z`), i));
  const series = Object.fromEntries(
    POLLS.map((p) => {
      const v = block?.hourly?.[GLOBAL_VARS[p]];
      return [p, Array.isArray(v) ? v.map(num) : []];
    }),
  ) as Record<GlobalPollutant, (number | null)[]>;
  /** Value of p at t − k hours. */
  const at = (p: GlobalPollutant, t: number, k: number) => {
    const i = idx.get(t - k * H);
    return i === undefined ? null : (series[p][i] ?? null);
  };
  const back = (p: GlobalPollutant, t: number, len: number) => Array.from({ length: len }, (_, k) => at(p, t, k));

  for (let j = 0; j < n; j++) {
    const t = t0 + j * H;
    const r = usAqiHourly({
      pm25: nowcast(back('pm25', t, 12)),
      pm10: nowcast(back('pm10', t, 12)),
      o3: mean(back('o3', t, 8), 6),
      // NAQI's and the US scale's CO input is mg/m³; Open-Meteo gives µg/m³.
      co: ((x) => (x === null ? null : x / 1000))(mean(back('co', t, 8), 6)),
      no2: at('no2', t, 0),
      so2: at('so2', t, 0),
    });
    out.a.push(r ? r.aqi : null);
    out.d += r ? DOMINANT_CODE[r.dominant] : '-';
    for (const p of POLLS) out.c[p].push(round(at(p, t, 0), p === 'pm25' ? 1 : 0));
  }
  return out;
}

/** Start of the UTC hour. */
export const floorHour = (ms: number) => Math.floor(ms / H) * H;

export interface GlobalResponse {
  sites: readonly WorldCity[];
  body: unknown;
}

export function buildGlobal(responses: readonly GlobalResponse[], nowMs = Date.now()): GlobalBundle {
  const t0 = floorHour(nowMs) - PAST_HOURS * H;
  const n = PAST_HOURS + 1 + FUTURE_HOURS;
  const cities: Record<string, GlobalCity> = {};
  for (const r of responses) {
    const blocks: Block[] = Array.isArray(r.body) ? (r.body as Block[]) : [r.body as Block];
    r.sites.forEach((s, i) => {
      const scored = scoreBlock(blocks[i], t0, n);
      if (scored.a.some((x) => x !== null)) cities[worldKey(s)] = scored;
    });
  }
  return { v: 1, generatedAt: new Date(nowMs).toISOString(), source: GLOBAL_SOURCE, t0: new Date(t0).toISOString(), n, cities };
}

export interface FetchGlobalOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Coordinates per request. */
  chunk?: number;
  /** Pause between requests: Open-Meteo's free tier allows 600 calls a minute, one per coordinate. */
  pauseMs?: number;
  /** Base backoff between retries (tests set 0). */
  retryMs?: number;
}

export async function fetchGlobalResponses(sites: readonly WorldCity[] = WORLD_CITIES, opts: FetchGlobalOptions = {}): Promise<GlobalResponse[]> {
  const f = opts.fetchImpl ?? fetch;
  const size = opts.chunk ?? 100;
  const pause = opts.pauseMs ?? 12_000;
  const out: GlobalResponse[] = [];
  for (let i = 0; i < sites.length; i += size) {
    if (i > 0 && pause > 0) await new Promise((r) => setTimeout(r, pause));
    const batch = sites.slice(i, i + size);
    // Retry rate limits, server errors and network failures (a kept-alive socket the
    // server closed during the pause shows up as "fetch failed"), with backoff.
    let res: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, (opts.retryMs ?? 15_000) * attempt));
      try {
        res = await f(globalUrl(batch), { headers: { accept: 'application/json', 'user-agent': opts.userAgent ?? 'globalmetrics-ingest', connection: 'close' } });
        lastError = null;
      } catch (e) {
        lastError = e;
        res = null;
        continue;
      }
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
    }
    if (!res) {
      const cause = lastError instanceof Error ? `${lastError.message}${lastError.cause ? ` (${String((lastError.cause as Error).message ?? lastError.cause)})` : ''}` : String(lastError);
      throw new Error(`global: ${cause} for ${batch.length} cities at ${i}`);
    }
    if (!res.ok) throw new Error(`global: HTTP ${res.status} for ${batch.length} cities at ${i}`);
    out.push({ sites: batch, body: await res.json() });
  }
  return out;
}

// ─── Reading the bundle (the website) ───────────────────────────────────

/** Index of the hour containing `nowMs`, or null when the bundle does not cover it. */
export function globalHour(b: Pick<GlobalBundle, 't0' | 'n'>, nowMs = Date.now()): number | null {
  const j = Math.floor((nowMs - Date.parse(b.t0)) / H);
  return j >= 0 && j < b.n ? j : null;
}

export interface GlobalNow {
  aqi: number;
  dominant: UsHourlyPollutant;
  /** Start of the model hour, ISO UTC. */
  at: string;
  /** This hour's concentrations, µg/m³ (CO in mg/m³). */
  conc: Partial<Record<GlobalPollutant, number>>;
}

/** The newest scored hour at or before `nowMs` (a gap of up to 3 h is bridged). */
export function globalNow(b: GlobalBundle, key: string, nowMs = Date.now()): GlobalNow | null {
  const c = b.cities[key];
  const j0 = globalHour(b, nowMs);
  if (!c || j0 === null) return null;
  for (let j = j0; j >= Math.max(0, j0 - 3); j--) {
    const aqi = c.a[j];
    if (aqi === null || aqi === undefined) continue;
    const conc: GlobalNow['conc'] = {};
    for (const p of POLLS) {
      const v = c.c[p][j];
      if (v !== null && v !== undefined) conc[p] = p === 'co' ? Math.round(v) / 1000 : v;
    }
    return { aqi, dominant: CODE_POLLUTANT[c.d[j]!]!, at: new Date(Date.parse(b.t0) + j * H).toISOString(), conc };
  }
  return null;
}

/** AQI per hour for [from, from + len) relative to the current hour (negative = past). */
export function globalSeries(b: GlobalBundle, key: string, from: number, len: number, nowMs = Date.now()): { t: string; aqi: number | null }[] {
  const c = b.cities[key];
  const j0 = globalHour(b, nowMs);
  if (!c || j0 === null) return [];
  const out: { t: string; aqi: number | null }[] = [];
  for (let k = from; k < from + len; k++) {
    const j = j0 + k;
    if (j < 0 || j >= b.n) continue;
    out.push({ t: new Date(Date.parse(b.t0) + j * H).toISOString(), aqi: c.a[j] ?? null });
  }
  return out;
}
