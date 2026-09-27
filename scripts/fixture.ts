/**
 * Build a real Bundle for local development from archived CPCB data, using the
 * production pipeline — no invented numbers.
 *
 *   node scripts/fixture.ts [YYYY-MM-DD] [--shift-to-now]
 *     → apps/web/src/fixtures/bundle.json   (then: npm run seed -w @saans/web)
 *     → .cache/stations.json                (station coordinates for build-map)
 *
 * Station readings come from the india-geodata Parquet archive (CC BY 4.0);
 * official daily values from the CPCB bulletins in .cache/backfill (run
 * scripts/backfill-bulletins.ts first). --shift-to-now moves every timestamp
 * so the newest reading is 20 minutes old, to exercise the "fresh" UI; the
 * bundle is then marked `fixture` and the site shows a DEV FIXTURE banner.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '@saans/data';
import {
  addDays,
  buildBundle,
  buildStations,
  bulletinUrl,
  istAt,
  istDate,
  istHour,
  rollupCity,
  slugForBulletinCity,
  type Accuracy,
  type BulletinRow,
  type BundleBulletin,
  type DayPoint,
  type HourPoint,
} from '@saans/pipeline';
import { CACHE, feedAsOf, loadParquetDays } from './lib/archive.ts';

const args = process.argv.slice(2);
const shift = args.includes('--shift-to-now');
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-09-25';

const snaps = await loadParquetDays([addDays(day, -2), addDays(day, -1), day]);
const inDay = snaps.filter((s) => istDate(s.at) === day);
if (!inDay.length) throw new Error(`no archive snapshots on ${day}`);
const T = inDay.at(-1)!.at;
const view = feedAsOf(snaps, T)!;
const stations = buildStations(view.rows);

// Hourly city estimates for the 24 IST hours up to T, where the archive has a reading that hour.
const hours: Record<string, HourPoint[]> = {};
for (let h = 23; h >= 0; h--) {
  const at = new Date(Date.parse(istHour(T)) - h * 3600_000).toISOString();
  const v = feedAsOf(snaps, at, 6);
  if (!v || Date.parse(at) - Date.parse(v.at) > 45 * 60_000) continue;
  const st = buildStations(v.rows);
  for (const c of CITIES) {
    const now = rollupCity(st.filter((s) => s.citySlug === c.slug));
    if (now) (hours[c.slug] ??= []).push({ t: at, aqi: now.aqi, u: now.us, n: now.valid });
  }
}

// Official daily values and the latest bulletin, from the backfill.
const bpath = join(CACHE, 'backfill', 'bulletins.json');
if (!existsSync(bpath)) throw new Error('run scripts/backfill-bulletins.ts first');
const bulletinsByDate = JSON.parse(readFileSync(bpath, 'utf8')) as Record<string, BulletinRow[]>;
const days: Record<string, DayPoint[]> = {};
const bulletins: Record<string, BundleBulletin> = {};
let n = 0;
let within10 = 0;
let exact = 0;
const accDates: string[] = [];
for (let d = addDays(day, -29); d <= day; d = addDays(d, 1)) {
  const rows = bulletinsByDate[d];
  if (!rows) continue;
  // Our own 16:00 estimate that day, where the archive has the 16:00 reading.
  const v = feedAsOf(snaps, istAt(d, 16));
  const ours = new Map<string, number>();
  if (v && Date.parse(istAt(d, 16)) - Date.parse(v.at) <= 30 * 60_000) {
    const st = buildStations(v.rows);
    for (const c of CITIES) {
      const now = rollupCity(st.filter((s) => s.citySlug === c.slug));
      if (now) ours.set(c.slug, now.aqi);
    }
  }
  for (const r of rows) {
    const slug = slugForBulletinCity(r.city);
    if (!slug) continue;
    (days[slug] ??= []).push({ d, aqi: r.aqi });
    const o = ours.get(slug) ?? null;
    bulletins[slug] = { date: d, aqi: r.aqi, prominent: r.prominent, used: r.used, total: r.total, url: bulletinUrl(d), ours: o };
    if (o !== null) {
      n++;
      if (Math.abs(o - r.aqi) <= 0.1 * r.aqi) within10++;
      if (o === r.aqi) exact++;
      accDates.push(d);
    }
  }
}
const accuracy: Accuracy | null = n ? { n, within10, exact, from: accDates.sort()[0]!, to: accDates.at(-1)! } : null;

let bundle = buildBundle({ stations, hours, days, bulletins, accuracy, now: new Date(Date.parse(T) + 20 * 60_000) });

if (shift) {
  const delta = Date.now() - 20 * 60_000 - Date.parse(T);
  const sh = (s: string | null) => (s ? new Date(Date.parse(s) + delta).toISOString() : s);
  bundle = JSON.parse(JSON.stringify(bundle));
  bundle.generatedAt = new Date().toISOString();
  bundle.feedAt = sh(bundle.feedAt);
  for (const c of Object.values(bundle.cities)) {
    if (c.now) c.now.at = sh(c.now.at)!;
    for (const s of c.stations) s.at = sh(s.at);
    for (const h of c.hours) h.t = istHour(sh(h.t)!);
  }
  for (const s of bundle.stations) s.t = sh(s.t);
  bundle.fixture = { builtFrom: T, shiftedMinutes: Math.round(delta / 60000) };
} else {
  bundle.fixture = { builtFrom: T, shiftedMinutes: 0 };
}

const out = join(import.meta.dirname, '..', 'apps', 'web', 'src', 'fixtures', 'bundle.json');
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify(bundle));
writeFileSync(
  join(CACHE, 'stations.json'),
  JSON.stringify(stations.filter((s) => s.citySlug).map((s) => ({ slug: s.citySlug, lat: s.lat, lon: s.lon }))),
);

const size = (JSON.stringify(bundle).length / 1024).toFixed(0);
const live = Object.values(bundle.cities).filter((c) => c.now).length;
console.log(`fixture from ${T}${shift ? ' (shifted to now)' : ''}: ${stations.length} stations, ${live}/25 launch cities with data, ${size} KB`);
console.log(`hours per city (Delhi): ${bundle.cities.delhi?.hours.length}, days: ${bundle.cities.delhi?.days.length}, bulletin: ${bundle.cities.delhi?.bulletin?.date} = ${bundle.cities.delhi?.bulletin?.aqi}`);
console.log(`accuracy in fixture: ${JSON.stringify(accuracy)}`);
