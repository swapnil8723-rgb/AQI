/**
 * data.gov.in resource 3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69,
 * "Real time Air Quality Index from various locations" (CPCB).
 *
 * Facts established on 26 Sep 2026 (PLAN.md §3.2 items 1 and 5):
 * - Fields: country, state, city, station, last_update, latitude, longitude,
 *   pollutant_id, min_value, max_value, avg_value. (Older docs call them
 *   pollutant_min/max/avg; both spellings are accepted.)
 * - avg_value is the pollutant's AQI **sub-index**, not a concentration.
 *   Inverting it reproduces CPCB's concentration archive (CO 28 → 0.56 mg/m³,
 *   archive 0.60). min/max are the lowest/highest hourly sub-index in 24 h;
 *   avg is always between them.
 * - last_update is IST, "DD-MM-YYYY HH:MM:SS".
 * - pollutant_id is PM2.5, PM10, NO2, SO2, CO, OZONE, NH3. Missing = "NA".
 * - About 3,300 rows (≈ 500 stations) per snapshot; ~9% are NA.
 * - The public sample key returns 10 rows a page and is rate limited (HTTP 429).
 */

import type { Pollutant } from '@saans/aqi';
import type { FeedRow } from './types.ts';
import { parseIst } from './time.ts';

export const RESOURCE_ID = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
export const FEED_URL = `https://api.data.gov.in/resource/${RESOURCE_ID}`;

const POLLUTANT_IDS: Record<string, Pollutant> = {
  'PM2.5': 'pm25',
  PM25: 'pm25',
  PM10: 'pm10',
  NO2: 'no2',
  SO2: 'so2',
  CO: 'co',
  OZONE: 'o3',
  O3: 'o3',
  NH3: 'nh3',
};

export function pollutantFromId(id: unknown): Pollutant | null {
  if (typeof id !== 'string') return null;
  return POLLUTANT_IDS[id.trim().toUpperCase()] ?? null;
}

const NA = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-']);

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (NA.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

export interface ParseResult {
  rows: FeedRow[];
  rejected: number;
  reasons: Record<string, number>;
}

/** Validate and normalise raw API records. Never throws on bad rows; counts them. */
export function parseFeedRecords(records: unknown): ParseResult {
  const rows: FeedRow[] = [];
  const reasons: Record<string, number> = {};
  const reject = (r: string) => {
    reasons[r] = (reasons[r] ?? 0) + 1;
  };
  if (!Array.isArray(records)) return { rows, rejected: 1, reasons: { 'not-an-array': 1 } };
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') {
      reject('not-an-object');
      continue;
    }
    const r = rec as Record<string, unknown>;
    const pollutant = pollutantFromId(r.pollutant_id);
    if (!pollutant) {
      reject('unknown-pollutant');
      continue;
    }
    const station = str(r.station);
    const city = str(r.city);
    const state = str(r.state);
    if (!station || !city) {
      reject('missing-station');
      continue;
    }
    rows.push({
      state,
      city,
      station,
      updatedAt: parseIst(str(r.last_update)),
      lat: num(r.latitude),
      lon: num(r.longitude),
      pollutant,
      lo: num(r.min_value ?? r.pollutant_min),
      hi: num(r.max_value ?? r.pollutant_max),
      avg: num(r.avg_value ?? r.pollutant_avg),
    });
  }
  return { rows, rejected: Object.values(reasons).reduce((a, b) => a + b, 0), reasons };
}

export interface FeedPage {
  total?: number | string;
  count?: number | string;
  records?: unknown[];
  status?: string;
  message?: string;
  error?: string;
}

export function feedPageUrl(apiKey: string, limit: number, offset: number): string {
  const q = new URLSearchParams({ 'api-key': apiKey, format: 'json', limit: String(limit), offset: String(offset) });
  return `${FEED_URL}?${q}`;
}

export interface FetchFeedOptions {
  apiKey: string;
  /** Rows per page. Registered keys accept large pages; the sample key caps at 10. */
  pageSize?: number;
  /** Give up after this many ms in total. */
  deadlineMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Page through the whole feed. Retries 429/5xx with backoff (data.gov.in
 * throttles bursts), adapts to a smaller page ceiling, and stops at the
 * deadline rather than running forever against a slow endpoint.
 */
export async function fetchFeed(opts: FetchFeedOptions): Promise<{ records: unknown[]; total: number; pages: number }> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  const deadline = opts.deadlineMs ?? 240_000;
  let limit = opts.pageSize ?? 1000;
  const records: unknown[] = [];
  let total = Infinity;
  let pages = 0;

  const getPage = async (offset: number): Promise<FeedPage> => {
    let wait = 2000;
    for (let attempt = 0; ; attempt++) {
      if (Date.now() - started > deadline) throw new Error(`feed: deadline after ${records.length} rows`);
      let res: Response;
      try {
        res = await f(feedPageUrl(opts.apiKey, limit, offset), {
          headers: { accept: 'application/json', 'user-agent': opts.userAgent ?? 'saans-ingest' },
        });
      } catch (e) {
        if (attempt >= 4) throw new Error(`feed: network error at offset ${offset}: ${String(e)}`);
        await sleep(wait);
        wait = Math.min(wait * 2, 30_000);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error(`feed: HTTP ${res.status} at offset ${offset}`);
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait);
        wait = Math.min(wait * 2, 30_000);
        continue;
      }
      if (!res.ok) throw new Error(`feed: HTTP ${res.status} at offset ${offset}`);
      const body = (await res.json()) as FeedPage;
      if (body.error) throw new Error(`feed: ${body.error}`);
      return body;
    }
  };

  while (records.length < total) {
    const page = await getPage(records.length);
    pages++;
    const got = Array.isArray(page.records) ? page.records : [];
    const t = Number(page.total);
    if (Number.isFinite(t)) total = t;
    if (got.length === 0) break;
    records.push(...got);
    // A key with a lower ceiling returns fewer rows than asked; page at that size.
    if (got.length < limit && records.length < total) limit = got.length;
    if (records.length < total) await sleep(300 + Math.random() * 400);
  }
  return { records, total: Number.isFinite(total) ? total : records.length, pages };
}
