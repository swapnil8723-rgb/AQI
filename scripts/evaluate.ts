/**
 * Re-measure the modelled estimate against CPCB's bulletin, out of sample.
 *
 *   node scripts/evaluate.ts [window=21]
 *
 * For every bulletin day CAMS still holds (~88 days), it learns the
 * correction from the `window` days *before* that day only — exactly what
 * scripts/calibrate.ts does in production — then scores the 16:00 IST
 * estimate against that day's bulletin with the production arithmetic
 * (camsCalibration, camsCityNow). AGENTS.md rule 5: publish what this prints,
 * and re-run it whenever the method changes.
 *
 * Bulletins come from .cache/backfill/bulletins.json (`npm run backfill`)
 * plus any later PDFs, fetched from CPCB and cached in .cache/bulletin.
 *
 * Measured 9 Oct 2026 over 1,650 city-days (3 Aug – 8 Oct): 28% within
 * ±10%, 61% within ±25%, 89% within ±50%; same CPCB category on 65%; the
 * model's top pollutant matched CPCB's prominent one on only 13% (CAMS ozone
 * tops its sub-indices on ~9 in 10 city-days, CPCB names ozone on ~1 in 20).
 * Tried and rejected the same day: per-pollutant factors (18/42/68 — learning
 * a factor only on days CPCB names that pollutant biases it upward) and two
 * factors per city fitted on the AQI (29/59/86 — no better).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '@saans/data';
import { naqiCategory } from '@saans/aqi';
import {
  addDays,
  camsAt,
  camsCalibration,
  camsCityNow,
  fetchCamsResponses,
  istAt,
  parseBulletinText,
  slugForBulletinCity,
  type CalibrationPair,
  type CamsCity,
} from '@saans/pipeline';
import { extractText, getDocumentProxy } from 'unpdf';

const ROOT = join(import.meta.dirname, '..');
const UA = 'SaansAQI/1.0 (accuracy evaluation; contact support@risescribe.com)';
const WINDOW = Number(process.argv[2] ?? 21) || 21;
const PROM: Record<string, string> = { 'PM2.5': 'pm25', PM10: 'pm10', O3: 'o3', NO2: 'no2', CO: 'co', SO2: 'so2', NH3: 'nh3' };

type Row = { city: string; aqi: number; prominent: string[] };
const backfill = join(ROOT, '.cache/backfill/bulletins.json');
if (!existsSync(backfill)) {
  console.error('Run `npm run backfill -- <from> <to>` first (needs .cache/backfill/bulletins.json).');
  process.exit(2);
}
const bulletins = JSON.parse(readFileSync(backfill, 'utf8')) as Record<string, Row[]>;
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const first = addDays(today, -88);

// Days after the backfill: CPCB's PDFs, cached.
mkdirSync(join(ROOT, '.cache/bulletin'), { recursive: true });
for (let d = first; d < today; d = addDays(d, 1)) {
  if (bulletins[d]) continue;
  const file = join(ROOT, `.cache/bulletin/AQI_Bulletin_${d.replaceAll('-', '')}.pdf`);
  let bytes: Uint8Array;
  if (existsSync(file)) bytes = new Uint8Array(readFileSync(file));
  else {
    const r = await fetch(`https://cpcb.gov.in/upload/Downloads/AQI_Bulletin_${d.replaceAll('-', '')}.pdf`, { headers: { 'user-agent': UA } });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('pdf')) continue;
    bytes = new Uint8Array(await r.arrayBuffer());
    writeFileSync(file, bytes);
  }
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  const b = parseBulletinText(text, '');
  if (b?.date === d) bulletins[d] = b.rows.map((r) => ({ city: r.city, aqi: r.aqi, prominent: r.prominent }));
}

// One request: 92 days of model hours for every launch city.
const sites = CITIES.map((c) => ({ slug: c.slug, name: c.en, state: c.state, lat: c.lat, lon: c.lon }));
const responses = await fetchCamsResponses(sites, { pastDays: 92, userAgent: UA });

interface Day { d: string; cams: Map<string, CamsCity>; cpcb: Map<string, Row> }
const days: Day[] = [];
for (const d of Object.keys(bulletins).sort()) {
  if (d < first || d >= today) continue;
  const cams = new Map(camsAt(responses, Date.parse(istAt(d, 16))).filter((c) => c.slug).map((c) => [c.slug!, c]));
  const cpcb = new Map(bulletins[d]!.map((r) => [slugForBulletinCity(r.city) ?? '', r]));
  days.push({ d, cams, cpcb });
}

const err: number[] = [];
let sameCat = 0;
let samePol = 0;
for (let i = WINDOW; i < days.length; i++) {
  const pairs: CalibrationPair[] = [];
  for (const day of days.slice(i - WINDOW, i)) {
    for (const [slug, c] of day.cams) {
      const raw = camsCityNow(c); // uncalibrated, as calibrate.ts pairs it
      const b = day.cpcb.get(slug);
      if (raw && b) pairs.push({ slug, cpcb: b.aqi, ours: raw.aqi });
    }
  }
  const cal = camsCalibration(pairs);
  const day = days[i]!;
  for (const [slug, c] of day.cams) {
    const b = day.cpcb.get(slug);
    const n = camsCityNow(c, cal);
    if (!b || !n) continue;
    err.push(Math.abs(n.aqi - b.aqi) / b.aqi);
    if (naqiCategory(n.aqi) === naqiCategory(b.aqi)) sameCat++;
    if (b.prominent[0] && PROM[b.prominent[0]] === n.dominant[0]) samePol++;
  }
}
if (!err.length) {
  console.error(`not enough days: ${days.length} bulletin days, window ${WINDOW}`);
  process.exit(1);
}
const pct = (x: number) => `${Math.round((100 * x) / err.length)}%`;
const within = (t: number) => pct(err.filter((e) => e <= t).length);
const median = [...err].sort((a, b) => a - b)[err.length >> 1]!;
console.log(`${err.length} city-days, ${days[WINDOW]?.d} … ${days.at(-1)?.d}, correction learned on the previous ${WINDOW} days`);
console.log(`within ±10%: ${within(0.1)} · ±25%: ${within(0.25)} · ±50%: ${within(0.5)} · median error ${Math.round(100 * median)}%`);
console.log(`same CPCB category: ${pct(sameCat)} · model's top pollutant = CPCB's prominent: ${pct(samePol)}`);
