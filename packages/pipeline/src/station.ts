import {
  naqiConcentration,
  naqiFromSubIndices,
  usAqi,
  type Pollutant,
  type SubIndices,
} from '@saans/aqi';
import { cityForFeed, parseStationName, stationId } from '@saans/data';
import type { FeedRow, Reading, Station } from './types.ts';

/** A station whose newest update is older than this (vs the feed's newest) is stale. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Abnormal-value rules (PLAN.md §3.2 item 4), calibrated on 3,279 real rows
 * from 25 Sep 2026. Flagged readings stay in the archive; excluded ones are
 * left out of the station AQI.
 *
 * - negative: impossible → excluded.
 * - flat: the 24-h hourly range is ≤ 1 index point while the reading sits in
 *   Moderate or worse (101–449). A working sensor at that level always moves;
 *   e.g. Chhatikara (Vrindavan) CO read 147–148 all day. Above 450 a flat
 *   trace can be a genuinely capped Severe day, so it is not flagged.
 * - spike: the sub-index jumped > 150 points since the previous hour while the
 *   rest of the city moved < 30 (needs history; see applySpikeRule) → excluded.
 * - pm-ratio: PM2.5 concentration above PM10 is physically impossible
 *   (PM2.5 ⊂ PM10). Seen 0 times in 386 stations on 25 Sep; flagged for
 *   review, not excluded, because we cannot tell which sensor is wrong.
 */
export const FLAT_MAX_RANGE = 1;
export const FLAT_MIN_INDEX = 101;
export const FLAT_MAX_INDEX = 450;
export const SPIKE_JUMP = 150;
export const SPIKE_CITY_JUMP = 30;

export function readingFrom(p: Pollutant, row: FeedRow): Reading | null {
  if (row.avg === null) return null;
  const r: Reading = { i: row.avg, lo: row.lo, hi: row.hi, c: naqiConcentration(p, row.avg) };
  if (row.avg < 0) {
    r.flag = 'negative';
    r.excluded = true;
    r.c = null;
  } else if (
    row.lo !== null &&
    row.hi !== null &&
    row.hi - row.lo <= FLAT_MAX_RANGE &&
    row.avg >= FLAT_MIN_INDEX &&
    row.avg < FLAT_MAX_INDEX
  ) {
    r.flag = 'flat';
    r.excluded = true;
  }
  return r;
}

/** Recompute AQI, dominant pollutant, US AQI and validity from a station's usable readings. */
export function scoreStation(s: Station, feedNewest: number | null): Station {
  const sub: SubIndices = {};
  for (const [p, r] of Object.entries(s.readings) as [Pollutant, Reading][]) {
    if (!r.excluded) sub[p] = r.i;
  }
  const n = naqiFromSubIndices(sub);
  const conc = (p: Pollutant) => {
    const r = s.readings[p];
    return r && !r.excluded ? r.c : null;
  };
  const us = usAqi({ pm25: conc('pm25'), pm10: conc('pm10'), o3: conc('o3'), co: conc('co') });

  const pm25 = conc('pm25');
  const pm10 = conc('pm10');
  if (pm25 !== null && pm10 !== null && pm25 > pm10) {
    for (const p of ['pm25', 'pm10'] as const) {
      const r = s.readings[p];
      if (r && !r.flag) r.flag = 'pm-ratio';
    }
  }

  const at = s.updatedAt ? Date.parse(s.updatedAt) : null;
  const stale = feedNewest !== null && (at === null || feedNewest - at > STALE_AFTER_MS);
  const valid = n.valid && !stale;
  const out: Station = { ...s, aqi: n.aqi, dominant: n.dominant, us: n.valid ? (us?.aqi ?? null) : null, valid, stale };
  if (!n.valid) out.reason = n.reason;
  else if (stale) out.reason = 'stale';
  else delete out.reason;
  return out;
}

/** Group normalised feed rows into scored stations. */
export function buildStations(rows: FeedRow[]): Station[] {
  const by = new Map<string, { rows: FeedRow[] }>();
  for (const row of rows) {
    const id = stationId(row.station);
    let g = by.get(id);
    if (!g) by.set(id, (g = { rows: [] }));
    g.rows.push(row);
  }
  let feedNewest: number | null = null;
  for (const row of rows) {
    if (row.updatedAt) {
      const t = Date.parse(row.updatedAt);
      if (feedNewest === null || t > feedNewest) feedNewest = t;
    }
  }

  const out: Station[] = [];
  for (const [id, g] of by) {
    const first = g.rows[0]!;
    const { place, agency } = parseStationName(first.station, first.city);
    const lat = g.rows.find((r) => r.lat !== null)?.lat ?? null;
    const lon = g.rows.find((r) => r.lon !== null)?.lon ?? null;
    if (lat === null || lon === null) continue;
    let updatedAt: string | null = null;
    const readings: Station['readings'] = {};
    for (const row of g.rows) {
      if (row.updatedAt && (!updatedAt || row.updatedAt > updatedAt)) updatedAt = row.updatedAt;
      const r = readingFrom(row.pollutant, row);
      if (r) readings[row.pollutant] = r;
    }
    const city = cityForFeed(first.city, first.state);
    out.push(
      scoreStation(
        {
          id,
          name: first.station,
          place,
          agency,
          city: first.city,
          state: first.state,
          citySlug: city?.slug ?? null,
          lat,
          lon,
          updatedAt,
          readings,
          aqi: null,
          dominant: [],
          us: null,
          valid: false,
          stale: false,
        },
        feedNewest,
      ),
    );
  }
  return out;
}

/**
 * Spike rule, needs the previous hour. `prev` maps station id → pollutant →
 * previous sub-index. A reading is excluded when it jumped by more than
 * SPIKE_JUMP while the median jump of the same pollutant across the rest of
 * the city stayed under SPIKE_CITY_JUMP. Returns the stations re-scored.
 */
export function applySpikeRule(
  stations: Station[],
  prev: Map<string, Partial<Record<Pollutant, number>>>,
  feedNewest: number | null,
): Station[] {
  const byCity = new Map<string, Station[]>();
  for (const s of stations) {
    const k = `${s.city}|${s.state}`;
    let a = byCity.get(k);
    if (!a) byCity.set(k, (a = []));
    a.push(s);
  }
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };
  let changed = false;
  for (const group of byCity.values()) {
    for (const s of group) {
      const before = prev.get(s.id);
      if (!before) continue;
      for (const [p, r] of Object.entries(s.readings) as [Pollutant, Reading][]) {
        const was = before[p];
        if (r.excluded || was === undefined) continue;
        const jump = Math.abs(r.i - was);
        if (jump <= SPIKE_JUMP) continue;
        const others = group
          .filter((o) => o.id !== s.id)
          .map((o) => {
            const w = prev.get(o.id)?.[p];
            const n = o.readings[p];
            return w === undefined || !n ? null : Math.abs(n.i - w);
          })
          .filter((x): x is number => x !== null);
        // A lone station has no neighbours to disagree with: leave it alone.
        if (others.length && median(others) < SPIKE_CITY_JUMP) {
          r.flag = 'spike';
          r.excluded = true;
          changed = true;
        }
      }
    }
  }
  return changed ? stations.map((s) => scoreStation(s, feedNewest)) : stations;
}

export function stationFlags(s: Station): string[] {
  const out: string[] = [];
  for (const [p, r] of Object.entries(s.readings) as [Pollutant, Reading][]) {
    if (r.flag) out.push(`${p}:${r.flag}`);
  }
  return out;
}
