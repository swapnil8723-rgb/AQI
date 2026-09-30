/**
 * data.gov.in resource 3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69,
 * "Real time Air Quality Index from various locations" (CPCB).
 *
 * **The live feed is dead** (30 Sep 2026): data.gov.in refuses connections and
 * CPCB's legacy endpoints answer 404, so the HTTP client that paged this
 * resource has been deleted — there is nothing to fetch. The hourly estimate
 * now comes from `cams.ts`.
 *
 * The parser below stays, and is not dead code: `scripts/fixture.ts` and
 * `scripts/gate.ts` replay the archived snapshots through it, the tests cover
 * it, and it is the way back if CPCB ever publishes a station feed again.
 * Restoring that means writing a fresh client for whatever the new endpoint
 * is, then pointing `hourly()` at `buildStations(parseFeedRecords(...))` and
 * dropping `live: 'cams'`.
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
 */

import type { Pollutant } from '@saans/aqi';
import type { FeedRow } from './types.ts';
import { parseIst } from './time.ts';

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
