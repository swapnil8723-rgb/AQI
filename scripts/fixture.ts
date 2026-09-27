/**
 * Build a real Bundle for local development from archived CPCB data, using the
 * production pipeline — no invented numbers.
 *
 *   node scripts/fixture.ts            → replay archived data as "today"
 *   node scripts/fixture.ts 2026-09-23 → a specific archived day, unshifted
 *
 * Writes apps/web/src/fixtures/bundle.json and replay-30d.json (then
 * `npm run seed`), and .cache/stations.json + .cache/city-coords.json for the
 * map and replay builds.
 *
 * Replay mode keeps every date coherent: it picks the archived snapshot whose
 * IST time of day is closest to (not after) the current time, and moves the
 * whole day — readings, hourly history, bulletins — by a whole number of
 * days. A bulletin is included only if CPCB would already have published it
 * at that hour (after 16:30 IST), exactly as in production.
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES, nameKey } from '@saans/data';
import {
  addDays,
  buildBundle,
  buildReplay,
  buildStations,
  bulletinUrl,
  coordLookup,
  istAt,
  istDate,
  istHour,
  istParts,
  rollupCity,
  slugForBulletinCity,
  type Accuracy,
  type BulletinRow,
  type Bundle,
  type BundleBulletin,
  type CityCoord,
  type DayPoint,
  type HourPoint,
} from '@saans/pipeline';
import { CACHE, feedAsOf, loadParquetDays, type Snapshot } from './lib/archive.ts';

const DAY = 86_400_000;
const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const ARCHIVE_DAYS = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const snaps = await loadParquetDays(ARCHIVE_DAYS);
const full = snaps.filter((s) => s.rows.length >= 2500);

// Pick the snapshot to replay.
let T: string;
let shiftDays = 0;
if (arg) {
  const inDay = full.filter((s) => istDate(s.at) === arg);
  if (!inDay.length) throw new Error(`no full archive snapshot on ${arg}`);
  T = inDay.at(-1)!.at;
} else {
  const now = Date.now();
  const tod = (ms: number) => { const p = istParts(ms); return p.h * 60 + p.mi; };
  const nowTod = tod(now);
  const pick = full
    .map((s) => ({ s, age: nowTod - tod(Date.parse(s.at)) }))
    .filter((x) => x.age >= 0)
    .sort((a, b) => a.age - b.age || b.s.at.localeCompare(a.s.at))[0]
    // Just after midnight nothing is earlier today: take the latest snapshot of any day.
    ?? { s: full.at(-1)!, age: 0 };
  T = pick.s.at;
  shiftDays = Math.round((Date.parse(`${istDate(now)}T00:00:00+05:30`) - Date.parse(`${istDate(T)}T00:00:00+05:30`)) / DAY);
  if (pick.age < 0) shiftDays -= 1;
}
const sourceDay = istDate(T);
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

// Official values from the bulletin backfill (scripts/backfill-bulletins.ts).
const bpath = join(CACHE, 'backfill', 'bulletins.json');
if (!existsSync(bpath)) throw new Error('run: npm run backfill -- 2025-09-01 2026-09-26');
const bulletinsByDate = JSON.parse(readFileSync(bpath, 'utf8')) as Record<string, BulletinRow[]>;
// The 4 PM bulletin appears around 17:00; before that, the newest one is yesterday's.
const lastBulletinDay = istParts(T).h * 60 + istParts(T).mi >= 16 * 60 + 30 ? sourceDay : addDays(sourceDay, -1);
const days: Record<string, DayPoint[]> = {};
const bulletins: Record<string, BundleBulletin> = {};
let n = 0;
let within10 = 0;
let exact = 0;
const accDates: string[] = [];
for (let d = addDays(lastBulletinDay, -29); d <= lastBulletinDay; d = addDays(d, 1)) {
  const rows = bulletinsByDate[d];
  if (!rows) continue;
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

// Same calendar day last year as the day shown (real, not shifted; the backfill starts 1 Sep 2025).
const shownDay = addDays(sourceDay, shiftDays);
const lastYearDate = `${Number(shownDay.slice(0, 4)) - 1}${shownDay.slice(4)}`;
const lastYear: Record<string, DayPoint> = {};
for (const r of bulletinsByDate[lastYearDate] ?? []) {
  const slug = slugForBulletinCity(r.city);
  if (slug) lastYear[slug] = { d: lastYearDate, aqi: r.aqi };
}

let bundle: Bundle = buildBundle({ stations, hours, days, bulletins, lastYear, accuracy, now: new Date(Date.parse(T) + 20 * 60_000) });

// City coordinates (every feed city) for the replay: mean of its stations.
const coordAcc = new Map<string, { city: string; state: string; la: number; lo: number; n: number }>();
for (const s of snaps) {
  for (const r of s.rows) {
    if (r.lat === null || r.lon === null) continue;
    const k = `${nameKey(r.city)}|${nameKey(r.state)}|${r.station}`;
    if (!coordAcc.has(k)) coordAcc.set(k, { city: r.city, state: r.state, la: r.lat, lo: r.lon, n: 1 });
  }
}
const byCity = new Map<string, CityCoord & { n: number }>();
for (const v of coordAcc.values()) {
  const k = `${nameKey(v.city)}|${nameKey(v.state)}`;
  const c = byCity.get(k) ?? { city: v.city, state: v.state, lat: 0, lon: 0, n: 0 };
  c.lat += v.la;
  c.lon += v.lo;
  c.n++;
  byCity.set(k, c);
}
const coords: CityCoord[] = [...byCity.values()].map((c) => ({ city: c.city, state: c.state, lat: c.lat / c.n, lon: c.lon / c.n }));
const dates30 = Array.from({ length: 30 }, (_, i) => addDays(lastBulletinDay, i - 29));
let replay = buildReplay(dates30, bulletinsByDate as Record<string, { city: string; aqi: number }[]>, coordLookup(coords));

// Move everything by whole days so it reads as today.
if (shiftDays) {
  const ms = shiftDays * DAY;
  const sh = (s: string | null) => (s ? new Date(Date.parse(s) + ms).toISOString() : s);
  const shd = (d: string) => addDays(d, shiftDays);
  bundle = JSON.parse(JSON.stringify(bundle)) as Bundle;
  bundle.generatedAt = sh(bundle.generatedAt)!;
  bundle.feedAt = sh(bundle.feedAt);
  for (const c of Object.values(bundle.cities)) {
    if (c.now) c.now.at = sh(c.now.at)!;
    for (const s of c.stations) s.at = sh(s.at);
    for (const h of c.hours) h.t = sh(h.t)!;
    for (const d of c.days) d.d = shd(d.d);
    if (c.bulletin) c.bulletin = { ...c.bulletin, date: shd(c.bulletin.date) };
  }
  for (const s of bundle.stations) s.t = sh(s.t);
  if (bundle.accuracy) bundle.accuracy = { ...bundle.accuracy, from: shd(bundle.accuracy.from), to: shd(bundle.accuracy.to) };
  replay = { ...replay, dates: replay.dates.map(shd) };
}
bundle.fixture = { builtFrom: T, shiftedDays: shiftDays };

const outDir = join(import.meta.dirname, '..', 'apps', 'web', 'src', 'fixtures');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'bundle.json'), JSON.stringify(bundle));
writeFileSync(join(outDir, 'replay-30d.json'), JSON.stringify(replay));
writeFileSync(join(CACHE, 'stations.json'), JSON.stringify(stations.filter((s) => s.citySlug).map((s) => ({ slug: s.citySlug, lat: s.lat, lon: s.lon }))));
writeFileSync(join(CACHE, 'city-coords.json'), JSON.stringify(coords));

const p = istParts(Date.parse(T) + shiftDays * DAY);
console.log(
  `fixture: CPCB data of ${sourceDay} ${String(istParts(T).h).padStart(2, '0')}:${String(istParts(T).mi).padStart(2, '0')} IST` +
    (shiftDays ? `, replayed as ${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')} (+${shiftDays} days)` : '') +
    ` · ${stations.length} stations · ${Object.values(bundle.cities).filter((c) => c.now).length}/25 cities · ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`,
);
console.log(`bulletin shown: ${bundle.cities.delhi?.bulletin?.date} · last year: ${bundle.cities.delhi?.lastYear?.d}=${bundle.cities.delhi?.lastYear?.aqi} · replay: ${replay.cities.length} cities × ${replay.dates.length} days`);
void (null as unknown as Snapshot);
