import { POLLUTANTS, type Pollutant } from '@saans/aqi';
import { CITIES, CITY_COORDS } from '@saans/data';
import {
  addDays,
  buildReplay,
  coordLookup,
  type Accuracy,
  type Replay,
  istDate,
  istHour,
  stationFlags,
  type BundleBulletin,
  type CityNow,
  type DayPoint,
  type HourPoint,
  type Reading,
  type Station,
} from '@saans/pipeline';

const CHUNK = 80;

async function batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += CHUNK) await db.batch(stmts.slice(i, i + CHUNK));
}

/** Each station's newest stored sub-indices in the 3 h before `hour`, for the spike rule. */
export async function previousReadings(db: D1Database, hour: string): Promise<Map<string, Partial<Record<Pollutant, number>>>> {
  const from = new Date(Date.parse(hour) - 3 * 3600_000).toISOString();
  const { results } = await db
    .prepare(`SELECT station_id, hour, ${POLLUTANTS.join(', ')} FROM station_hour WHERE hour >= ? AND hour < ? ORDER BY hour`)
    .bind(from, hour)
    .all<Record<string, number | string | null>>();
  const out = new Map<string, Partial<Record<Pollutant, number>>>();
  for (const r of results) {
    const v: Partial<Record<Pollutant, number>> = {};
    for (const p of POLLUTANTS) if (typeof r[p] === 'number') v[p] = r[p] as number;
    out.set(r.station_id as string, v); // ordered by hour, so the newest wins
  }
  return out;
}

/**
 * One row per station per IST hour. INSERT OR IGNORE: a station that has not
 * updated since the last run keeps its row and costs no write.
 */
export async function writeStationHours(db: D1Database, stations: Station[], today: string): Promise<number> {
  const stmts: D1PreparedStatement[] = [];
  const hourSql = `INSERT OR IGNORE INTO station_hour (station_id, hour, ${POLLUTANTS.join(', ')}, lo, hi, flags, aqi, us, dominant, valid)
    VALUES (?, ?, ${POLLUTANTS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?)`;
  const stationSql = `INSERT INTO stations (id, name, city, state, city_slug, lat, lon, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, lat = excluded.lat, lon = excluded.lon, city_slug = excluded.city_slug
    WHERE stations.last_seen < excluded.last_seen`;
  for (const s of stations) {
    stmts.push(db.prepare(stationSql).bind(s.id, s.name, s.city, s.state, s.citySlug, s.lat, s.lon, today, today));
    if (!s.updatedAt) continue;
    const lo: Record<string, number> = {};
    const hi: Record<string, number> = {};
    const vals = POLLUTANTS.map((p) => {
      const r: Reading | undefined = s.readings[p];
      if (!r) return null;
      if (r.lo !== null) lo[p] = r.lo;
      if (r.hi !== null) hi[p] = r.hi;
      return r.i;
    });
    const flags = stationFlags(s).join(',') || null;
    stmts.push(
      db.prepare(hourSql).bind(
        s.id,
        istHour(s.updatedAt),
        ...vals,
        JSON.stringify(lo),
        JSON.stringify(hi),
        flags,
        s.aqi,
        s.us,
        s.dominant.join(',') || null,
        s.valid ? 1 : 0,
      ),
    );
  }
  await batch(db, stmts);
  return stmts.length;
}

export async function writeCityHours(db: D1Database, hour: string, cities: Record<string, CityNow | null>): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const [slug, now] of Object.entries(cities)) {
    if (!now) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO city_hour (city_slug, hour, aqi, min, max, valid, total, dominant, us) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(slug, hour, now.aqi, now.min, now.max, now.valid, now.total, now.dominant.join(','), now.us),
    );
  }
  await batch(db, stmts);
}

/** Last 24 hourly estimates per city, oldest first. */
export async function cityHours(db: D1Database, hour: string): Promise<Record<string, HourPoint[]>> {
  const from = new Date(Date.parse(hour) - 23 * 3600_000).toISOString();
  const { results } = await db
    .prepare('SELECT city_slug, hour, aqi, us, valid FROM city_hour WHERE hour >= ? AND hour <= ? ORDER BY hour')
    .bind(from, hour)
    .all<{ city_slug: string; hour: string; aqi: number; us: number | null; valid: number }>();
  const out: Record<string, HourPoint[]> = {};
  for (const r of results) (out[r.city_slug] ??= []).push({ t: r.hour, aqi: r.aqi, u: r.us, n: r.valid });
  return out;
}

/** Official daily values (CPCB bulletin) for the last 30 days, oldest first. */
export async function bulletinDays(db: D1Database, today: string): Promise<Record<string, DayPoint[]>> {
  const from = istDate(Date.parse(`${today}T00:00:00+05:30`) - 30 * 86400_000);
  const { results } = await db
    .prepare('SELECT city_slug, date, aqi FROM bulletin WHERE city_slug IS NOT NULL AND date > ? ORDER BY date')
    .bind(from)
    .all<{ city_slug: string; date: string; aqi: number }>();
  const out: Record<string, DayPoint[]> = {};
  for (const r of results) (out[r.city_slug] ??= []).push({ d: r.date, aqi: r.aqi });
  return out;
}

/** Newest bulletin row per launch city. */
export async function latestBulletins(db: D1Database, url: (date: string) => string): Promise<Record<string, BundleBulletin>> {
  const { results } = await db
    .prepare(
      `SELECT b.* FROM bulletin b JOIN (SELECT city_slug, MAX(date) d FROM bulletin WHERE city_slug IS NOT NULL GROUP BY city_slug) m
       ON b.city_slug = m.city_slug AND b.date = m.d`,
    )
    .all<{ city_slug: string; date: string; aqi: number; prominent: string; used: number; total: number | null; ours: number | null }>();
  const out: Record<string, BundleBulletin> = {};
  for (const r of results) {
    out[r.city_slug] = {
      date: r.date,
      aqi: r.aqi,
      prominent: r.prominent ? r.prominent.split(',') : [],
      used: r.used,
      total: r.total,
      url: url(r.date),
      ours: r.ours,
    };
  }
  return out;
}

/** Our 16:00 estimate vs CPCB's bulletin, over every stored day (published on /about). */
export async function accuracy(db: D1Database): Promise<Accuracy | null> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN ABS(ours - aqi) <= 0.1 * aqi THEN 1 ELSE 0 END) AS within10,
              SUM(CASE WHEN ours = aqi THEN 1 ELSE 0 END) AS exact,
              MIN(date) AS "from", MAX(date) AS "to"
       FROM bulletin INDEXED BY bulletin_ours WHERE city_slug IS NOT NULL AND ours IS NOT NULL`,
    )
    .first<{ n: number; within10: number; exact: number; from: string; to: string }>();
  return r && r.n ? r : null;
}

/** CPCB's bulletin value on the same calendar day last year, per launch city. */
export async function lastYearBulletins(db: D1Database, today: string): Promise<Record<string, DayPoint>> {
  const date = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const { results } = await db
    .prepare('SELECT city_slug, date, aqi FROM bulletin WHERE city_slug IS NOT NULL AND date = ?')
    .bind(date)
    .all<{ city_slug: string; date: string; aqi: number }>();
  const out: Record<string, DayPoint> = {};
  for (const r of results) out[r.city_slug] = { d: r.date, aqi: r.aqi };
  return out;
}

/** The home map's 30-day replay: every city in the bulletin, located by its stations. */
export async function replay30(db: D1Database, lastDay: string): Promise<Replay> {
  const dates = Array.from({ length: 30 }, (_, i) => addDays(lastDay, i - 29));
  const { results: rows } = await db
    .prepare('SELECT date, city, aqi FROM bulletin WHERE date >= ? AND date <= ?')
    .bind(dates[0], lastDay)
    .all<{ date: string; city: string; aqi: number }>();
  const byDate: Record<string, { city: string; aqi: number }[]> = {};
  for (const r of rows) (byDate[r.date] ??= []).push({ city: r.city, aqi: r.aqi });
  // Coordinates are checked in rather than averaged from the `stations` table:
  // that table is filled only by the station feed, which is gone for good.
  return buildReplay(dates, byDate, coordLookup([...CITY_COORDS]));
}

export const LAUNCH_SLUGS = CITIES.map((c) => c.slug);
