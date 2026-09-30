/**
 * Learn the model's per-city correction from CPCB's own bulletins.
 *
 *   node scripts/calibrate.ts [days]        default 21
 *
 * Raw CAMS runs hot over India — measured against the 29 Sep 2026 bulletin it
 * was 2–5x CPCB across the 25 launch cities and within 10% on none of them.
 * This pairs each stored bulletin with what the model said at 16:00 IST the
 * same day, takes the median ratio per city, and writes it to KV as
 * `cams:calibration`, which the hourly job applies to the sub-indices.
 *
 * Measured over 539 city-days to 26 Sep 2026 this moves the fit from 0% to
 * about 28% of cities within 10% of CPCB, 72% within 25% and 92% within 50%.
 * It is a correction on a model, not a measurement: the page says so, and
 * /about publishes the band.
 *
 * Run it daily after the bulletin job, and once by hand to bootstrap — the
 * hourly job warns while `cams:calibration` is missing.
 *
 * Env: INGEST_URL (the Worker), INGEST_TOKEN.
 */
import { CITIES } from '@saans/data';
import { addDays, camsCalibration, camsCityNow, fetchCams, istAt, istDate, MIN_CALIBRATION_DAYS, type CalibrationPair, type CamsSite } from '@saans/pipeline';

const URL_ = (process.env.INGEST_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN ?? '';
const UA = 'SaansAQI/1.0 (air-quality archive; contact support@risescribe.com)';

if (!URL_ || !TOKEN) {
  console.error('Set INGEST_URL (the Worker address) and INGEST_TOKEN.');
  process.exit(2);
}

async function call(method: string, path: string, body?: string): Promise<string> {
  const res = await fetch(URL_ + path, {
    method,
    body,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

const days = Math.max(MIN_CALIBRATION_DAYS, Number(process.argv[2] ?? 21) || 21);
const today = istDate(Date.now());
const from = addDays(today, -days);

const sites: CamsSite[] = CITIES.map((c) => ({ slug: c.slug, name: c.en, state: c.state, lat: c.lat, lon: c.lon }));

const bulletins = JSON.parse(
  await call('GET', `/read/bulletins?a=${encodeURIComponent(from)}&b=${encodeURIComponent(today)}`),
) as { s: string; d: string; aqi: number }[];

// One CAMS request per bulletin day, at the 16:00 IST the bulletin describes.
const byDate = new Map<string, { s: string; aqi: number }[]>();
for (const r of bulletins) {
  if (!r.s || !(r.aqi > 0)) continue;
  let a = byDate.get(r.d);
  if (!a) byDate.set(r.d, (a = []));
  a.push({ s: r.s, aqi: r.aqi });
}

const pairs: CalibrationPair[] = [];
for (const [date, rows] of [...byDate].sort()) {
  const at = Date.parse(istAt(date, 16));
  // CAMS keeps ~92 days of past hours; anything older cannot be paired.
  const back = Math.ceil((Date.now() - at) / 86_400_000) + 2;
  if (back > 92) continue;
  let cams;
  try {
    cams = await fetchCams(sites, { pastDays: back, now: at, userAgent: UA });
  } catch (e) {
    console.error(`::warning::cams for ${date}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const ours = new Map<string, number>();
  for (const c of cams) {
    const n = c.slug ? camsCityNow(c) : null; // uncalibrated, by design
    if (c.slug && n) ours.set(c.slug, n.aqi);
  }
  for (const r of rows) {
    const o = ours.get(r.s);
    if (o) pairs.push({ slug: r.s, cpcb: r.aqi, ours: o });
  }
}

const cal = camsCalibration(pairs);
const cities = Object.keys(cal).filter((k) => k !== '*');
if (!cities.length) {
  console.error(`::error::no calibration from ${pairs.length} pairs over ${byDate.size} days — need ${MIN_CALIBRATION_DAYS} days per city`);
  process.exit(1);
}

await call('PUT', `/store/kv/${encodeURIComponent('cams:calibration')}`, JSON.stringify(cal));

const ks = cities.map((c) => cal[c]!).sort((a, b) => a - b);
console.log(
  `calibrated ${cities.length} cities from ${pairs.length} pairs over ${byDate.size} bulletin days; ` +
    `k ${ks[0]!.toFixed(2)}–${ks.at(-1)!.toFixed(2)}, fallback ${cal['*']}`,
);
