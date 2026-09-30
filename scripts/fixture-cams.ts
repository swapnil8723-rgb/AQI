/**
 * Build a real modelled Bundle for local development — no invented numbers.
 *
 *   node scripts/fixture-cams.ts          → CAMS as of now, calibrated
 *   node scripts/fixture-cams.ts --raw    → skip the calibration, to see the bias
 *
 * This is the dev counterpart of the production hourly job: live CAMS through
 * the production pipeline, corrected against the cached bulletin backfill, so
 * the modelled labelling can be checked at 360 px and 1440 px, light and dark,
 * EN and HI. `scripts/fixture.ts` still replays archived CPCB station data for
 * the station path, which is dormant while CPCB's feed is down.
 *
 * Writes apps/web/src/fixtures/bundle.json; run `npm run seed` after.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '@saans/data';
import {
  addDays,
  buildBundle,
  bulletinUrl,
  camsCalibration,
  camsCityNow,
  camsUrl,
  istAt,
  istDate,
  parseCams,
  slugForBulletinCity,
  type BundleBulletin,
  type CalibrationPair,
  type CamsSite,
  type CityNow,
  type DayPoint,
  type HourPoint,
} from '@saans/pipeline';

const ROOT = join(import.meta.dirname, '..');
const raw = process.argv.includes('--raw');
const UA = 'SaansAQI/1.0 (local fixture)';
const H = 3600_000;

interface BulletinRow {
  city: string;
  aqi: number;
  category: string;
  prominent: string[];
  used: number;
  total: number | null;
}
const bulletins = JSON.parse(readFileSync(join(ROOT, '.cache/backfill/bulletins.json'), 'utf8')) as Record<string, BulletinRow[]>;
const coords = JSON.parse(readFileSync(join(ROOT, '.cache/city-coords.json'), 'utf8')) as { city: string; state: string; lat: number; lon: number }[];

const sites: CamsSite[] = CITIES.map((c) => ({ slug: c.slug, name: c.en, state: c.state, lat: c.lat, lon: c.lon }));
const seen = new Set(CITIES.map((c) => c.en.toLowerCase()));
for (const co of coords) {
  if (seen.has(co.city.toLowerCase())) continue;
  seen.add(co.city.toLowerCase());
  sites.push({ slug: slugForBulletinCity(co.city), name: co.city, state: co.state, lat: co.lat, lon: co.lon });
}

// Calibrate against the most recent cached bulletins that CAMS still covers.
const dates = Object.keys(bulletins)
  .sort()
  .filter((d) => Date.now() - Date.parse(istAt(d, 16)) < 80 * 86_400_000)
  .slice(-3);

// One request, deep enough to reach the oldest bulletin being paired, then
// scored at many instants — parseCams takes the moment.
const oldest = dates.length ? Date.parse(istAt(dates[0]!, 16)) : Date.now();
const pastDays = Math.min(92, Math.ceil((Date.now() - oldest) / 86_400_000) + 2);
const body = await (await fetch(camsUrl(sites, pastDays), { headers: { accept: 'application/json', 'user-agent': UA } })).json();
const now = new Date();
const pairs: CalibrationPair[] = [];
for (const d of dates) {
  const at = Date.parse(istAt(d, 16));
  const scored = new Map<string, number>();
  for (const c of parseCams(sites, body, at)) {
    const n = c.slug ? camsCityNow(c) : null;
    if (c.slug && n) scored.set(c.slug, n.aqi);
  }
  for (const row of bulletins[d] ?? []) {
    const slug = slugForBulletinCity(row.city);
    const ours = slug ? scored.get(slug) : undefined;
    if (slug && ours && row.aqi > 0) pairs.push({ slug, cpcb: row.aqi, ours });
  }
}
const calibration = raw ? {} : camsCalibration(pairs);

const cams = parseCams(sites, body, now.getTime());
const cityNow: Record<string, CityNow | null> = {};
for (const c of cams) if (c.slug) cityNow[c.slug] = camsCityNow(c, calibration);

// 24 hours of history, scored from the same response.
const hours: Record<string, HourPoint[]> = {};
for (let i = 23; i >= 0; i--) {
  const t = now.getTime() - i * H;
  for (const c of parseCams(sites, body, t)) {
    if (!c.slug || !CITIES.some((x) => x.slug === c.slug)) continue;
    const n = camsCityNow(c, calibration);
    if (n) (hours[c.slug] ??= []).push({ t: new Date(t).toISOString(), aqi: n.aqi, u: n.us, n: 0 });
  }
}

// The last 30 days of CPCB's own bulletin, and the newest one per city.
const today = istDate(now);
const days: Record<string, DayPoint[]> = {};
const latest: Record<string, BundleBulletin> = {};
for (const d of Object.keys(bulletins).sort()) {
  if (d < addDays(today, -30) || d > today) continue;
  for (const row of bulletins[d] ?? []) {
    const slug = slugForBulletinCity(row.city);
    if (!slug || !CITIES.some((x) => x.slug === slug)) continue;
    (days[slug] ??= []).push({ d, aqi: row.aqi });
    latest[slug] = { date: d, aqi: row.aqi, prominent: row.prominent, used: row.used, total: row.total, url: bulletinUrl(d), ours: null };
  }
}

const bundle = buildBundle({ stations: [], cityNow, cams, calibration, live: 'cams', hours, days, bulletins: latest, now });
writeFileSync(join(ROOT, 'apps/web/src/fixtures/bundle.json'), JSON.stringify(bundle));

const ks = Object.keys(calibration).filter((k) => k !== '*');
const withNow = Object.values(cityNow).filter(Boolean).length;
console.log(
  `wrote apps/web/src/fixtures/bundle.json — ${cams.length} cities, ${withNow} launch cities with a live estimate, ` +
    `${Object.keys(latest).length} bulletins, calibration on ${ks.length} cities from ${pairs.length} pairs${raw ? ' (SKIPPED: --raw)' : ''}`,
);
console.log('next: npm run seed && npm run dev');
