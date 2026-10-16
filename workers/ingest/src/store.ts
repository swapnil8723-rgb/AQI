/**
 * Thin storage gateway for the Workers Free plan (10 ms CPU per request).
 *
 * On Free, the hourly work (fetch CPCB, parse ~3,500 rows, flags, AQI, the
 * bulletin PDF) runs in GitHub Actions (scripts/ingest-run.ts), which sends
 * the results here. This Worker only moves bytes: request bodies go straight
 * into D1 (one statement per table via SQLite's json_each), KV and R2 without
 * JSON.parse, and reads come back as a single JSON string built by SQLite.
 * Only fixed statements run — no SQL arrives over HTTP.
 *
 *   POST /store/d1/{stations|station_hour|city_hour|bulletin}   body: JSON array
 *   PUT  /store/kv/{bundle:v1|replay:30d|ingest:status|cams:calibration|global:v1}   body: the value
 *   GET  /store/kv/{ingest:status|cams:calibration}               the run status; the model correction
 *   PUT  /store/r2/{key}                                          body: the object
 *   GET  /read/{name}?a=&b=                                       one JSON document
 */
import { POLLUTANTS } from '@saans/aqi';
import type { Env } from './env.ts';

const P = POLLUTANTS;
const v = (k: string) => `j.value->>'${k}'`;

const WRITES: Record<string, string> = {
  stations: `INSERT INTO stations (id, name, city, state, city_slug, lat, lon, first_seen, last_seen)
    SELECT ${['id', 'name', 'city', 'state', 'slug', 'lat', 'lon', 'day', 'day'].map(v).join(', ')} FROM json_each(?1) AS j WHERE true
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, lat = excluded.lat, lon = excluded.lon, city_slug = excluded.city_slug
    WHERE stations.last_seen < excluded.last_seen`,
  station_hour: `INSERT OR IGNORE INTO station_hour (station_id, hour, ${P.join(', ')}, lo, hi, flags, aqi, us, dominant, valid)
    SELECT ${['id', 'hour', ...P, 'lo', 'hi', 'flags', 'aqi', 'us', 'dominant', 'valid'].map(v).join(', ')} FROM json_each(?1) AS j`,
  city_hour: `INSERT OR REPLACE INTO city_hour (city_slug, hour, aqi, min, max, valid, total, dominant, us)
    SELECT ${['slug', 'hour', 'aqi', 'min', 'max', 'valid', 'total', 'dominant', 'us'].map(v).join(', ')} FROM json_each(?1) AS j`,
  bulletin: `INSERT OR REPLACE INTO bulletin (city_key, date, city, city_slug, aqi, category, prominent, used, total, ours)
    SELECT ${['key', 'date', 'city', 'slug', 'aqi', 'category', 'prominent', 'used', 'total', 'ours'].map(v).join(', ')} FROM json_each(?1) AS j`,
};

/** Each read returns one row with one column `j`: a JSON document built by SQLite. ?1 = a, ?2 = b. */
const READS: Record<string, string> = {
  // Newest stored sub-indices per station in [a, b) — ordered, so the newest wins the object key.
  prev: `SELECT coalesce(json_group_object(station_id, json_object(${P.map((p) => `'${p}', ${p}`).join(', ')})), '{}') AS j
    FROM (SELECT * FROM station_hour WHERE hour >= ?1 AND hour < ?2 ORDER BY hour)`,
  hours: `SELECT coalesce(json_group_array(json_object('s', city_slug, 't', hour, 'aqi', aqi, 'u', us, 'n', valid)), '[]') AS j
    FROM (SELECT * FROM city_hour WHERE hour >= ?1 AND hour <= ?2 ORDER BY hour)`,
  // Launch cities only (city_slug set), dates in [a, b].
  bulletins: `SELECT coalesce(json_group_array(json_object('s', city_slug, 'd', date, 'aqi', aqi, 'p', prominent, 'used', used, 'total', total, 'ours', ours)), '[]') AS j
    FROM (SELECT * FROM bulletin WHERE city_slug IS NOT NULL AND date >= ?1 AND date <= ?2 ORDER BY date)`,
  // Every city, dates in [a, b] (the replay).
  bulletins_all: `SELECT coalesce(json_group_array(json_object('c', city, 'd', date, 'aqi', aqi)), '[]') AS j
    FROM bulletin WHERE date >= ?1 AND date <= ?2`,
  bulletin_count: `SELECT json_object('n', COUNT(*)) AS j FROM bulletin WHERE date = ?1 AND ?2 = ?2`,
  ours: `SELECT coalesce(json_group_object(city_slug, aqi), '{}') AS j FROM city_hour WHERE hour = ?1 AND ?2 = ?2`,
  accuracy: `SELECT json_object('n', COUNT(*), 'within10', SUM(CASE WHEN ABS(ours - aqi) <= 0.1 * aqi THEN 1 ELSE 0 END),
      'exact', SUM(CASE WHEN ours = aqi THEN 1 ELSE 0 END), 'from', MIN(date), 'to', MAX(date)) AS j
    FROM bulletin WHERE city_slug IS NOT NULL AND ours IS NOT NULL AND ?1 = ?1 AND ?2 = ?2`,
  coords: `SELECT coalesce(json_group_array(json_object('city', city, 'state', state, 'lat', lat, 'lon', lon)), '[]') AS j
    FROM (SELECT city, state, AVG(lat) AS lat, AVG(lon) AS lon FROM stations WHERE ?1 = ?1 AND ?2 = ?2 GROUP BY city, state)`,
  // Archive rows for hours in [a, b) — callers ask in 6-hour slices to stay under SQLite's 2 MB string limit.
  day: `SELECT coalesce(json_group_array(json_object('hour_utc', sh.hour, 'station_id', sh.station_id, 'station', s.name, 'city', s.city, 'state', s.state,
      'lat', s.lat, 'lon', s.lon, ${P.map((p) => `'${p}', sh.${p}`).join(', ')}, 'lo', sh.lo, 'hi', sh.hi, 'flags', sh.flags,
      'aqi', sh.aqi, 'us', sh.us, 'dominant', sh.dominant, 'valid', sh.valid)), '[]') AS j
    FROM station_hour sh JOIN stations s ON s.id = sh.station_id WHERE sh.hour >= ?1 AND sh.hour < ?2`,
  day_bulletin: `SELECT coalesce(json_group_array(json_object('date', date, 'city', city, 'city_slug', city_slug, 'aqi', aqi, 'category', category,
      'prominent', prominent, 'used', used, 'total', total, 'ours', ours)), '[]') AS j FROM bulletin WHERE date = ?1 AND ?2 = ?2`,
};

const KV_KEYS = new Set(['bundle:v1', 'replay:30d', 'ingest:status', 'cams:calibration', 'global:v1']);
/** Readable too: the hourly job needs the status and the correction it applies. */
const KV_READ = new Set(['ingest:status', 'cams:calibration']);

const out = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Handles /store/* and /read/* (already authorised). Null when the path is not ours. */
export async function store(req: Request, env: Env, url: URL): Promise<Response | null> {
  const [, area, kind, ...rest] = url.pathname.split('/');
  if (area === 'store' && kind === 'd1' && req.method === 'POST') {
    const sql = WRITES[rest[0] ?? ''];
    if (!sql) return out('{"error":"unknown table"}', 404);
    const r = await env.DB.prepare(sql).bind(await req.text()).run();
    return out(`{"changes":${r.meta.changes ?? 0}}`);
  }
  if (area === 'store' && kind === 'kv' && req.method === 'GET') {
    const key = decodeURIComponent(rest.join('/'));
    if (!KV_READ.has(key)) return out('{"error":"unknown key"}', 404);
    return out((await env.KV.get(key)) ?? 'null');
  }
  if (area === 'store' && kind === 'kv' && req.method === 'PUT') {
    const key = decodeURIComponent(rest.join('/'));
    if (!KV_KEYS.has(key)) return out('{"error":"unknown key"}', 404);
    // Bytes, not text: the world bundle is ~1.3 MB and decoding it would spend the Free plan's CPU.
    await env.KV.put(key, await req.arrayBuffer());
    return out('{"ok":true}');
  }
  if (area === 'store' && kind === 'r2' && req.method === 'PUT') {
    const key = decodeURIComponent(rest.join('/'));
    if (!/^(raw|archive|bulletin)\/[\w./-]+$/.test(key)) return out('{"error":"bad key"}', 400);
    await env.ARCHIVE.put(key, await req.arrayBuffer(), {
      httpMetadata: {
        contentType: req.headers.get('content-type') ?? 'application/octet-stream',
        ...(req.headers.get('x-content-encoding') ? { contentEncoding: req.headers.get('x-content-encoding')! } : {}),
      },
    });
    return out('{"ok":true}');
  }
  if (area === 'read' && req.method === 'GET') {
    const sql = READS[kind ?? ''];
    if (!sql) return out('{"error":"unknown read"}', 404);
    const j = await env.DB.prepare(sql).bind(url.searchParams.get('a') ?? '', url.searchParams.get('b') ?? '').first<string>('j');
    return out(j ?? 'null');
  }
  return null;
}
