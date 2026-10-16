/**
 * The ingest jobs, run by GitHub Actions on the Workers Free plan
 * (.github/workflows/ingest.yml). Same pipeline as the Worker's own jobs
 * (workers/ingest/src), but the CPU-heavy part runs here and the results are
 * stored through the Worker's thin /store gateway (workers/ingest/src/store.ts).
 *
 *   node scripts/ingest-run.ts auto               hourly; + bulletin 17–21 IST; + archive at 00 IST
 *   node scripts/ingest-run.ts hourly
 *   node scripts/ingest-run.ts bulletin [YYYY-MM-DD]
 *   node scripts/ingest-run.ts archive  [YYYY-MM-DD]
 *   node scripts/ingest-run.ts global              the world estimate (auto runs it when the last one is ~6 h old)
 *
 * The hourly estimate comes from CAMS (packages/pipeline/src/cams.ts) since
 * CPCB's machine-readable feed went down in Sep 2026; it needs no API key.
 * The official daily figure is still CPCB's bulletin, which is unaffected.
 * `scripts/calibrate.ts` keeps the model's per-city correction up to date.
 *
 * Env: INGEST_URL (the Worker), INGEST_TOKEN.
 */
import { gzipSync } from 'node:zlib';
import { POLLUTANTS } from '@saans/aqi';
import { CITIES, CITY_COORDS } from '@saans/data';
import {
  addDays,
  buildBundle,
  buildReplay,
  bulletinCityKey,
  bulletinUrl,
  camsAt,
  camsCityNow,
  buildGlobal,
  coordLookup,
  fetchCamsResponses,
  fetchGlobalResponses,
  GLOBAL_KEY,
  istAt,
  istDate,
  istHour,
  istParts,
  parseBulletinText,
  slugForBulletinCity,
  type Accuracy,
  type BundleBulletin,
  type CamsCalibration,
  type CamsSite,
  type CityNow,
  type DayPoint,
  type HourPoint,
} from '@saans/pipeline';
import { extractText, getDocumentProxy } from 'unpdf';

const URL_ = (process.env.INGEST_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN ?? '';
const UA = 'SaansAQI/1.0 (air-quality archive; contact support@risescribe.com)';
const H = 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

if (!URL_ || !TOKEN) {
  console.error('Set INGEST_URL (the Worker address) and INGEST_TOKEN.');
  process.exit(2);
}

async function call(method: string, path: string, body?: string | Uint8Array, headers: Record<string, string> = {}): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL_ + path, { method, body: body as BodyInit | undefined, headers: { authorization: `Bearer ${TOKEN}`, ...headers } });
    const text = await res.text();
    if (res.ok) return text;
    if (attempt < 2 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}
const read = async <T>(name: string, a = '', b = ''): Promise<T> =>
  JSON.parse(await call('GET', `/read/${name}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)) as T;
const d1 = (table: string, rows: unknown[]) => (rows.length ? call('POST', `/store/d1/${table}`, JSON.stringify(rows), { 'content-type': 'application/json' }) : Promise.resolve(''));
const kv = (key: string, value: string) => call('PUT', `/store/kv/${encodeURIComponent(key)}`, value, { 'content-type': 'application/json' });
const kvGet = async <T>(key: string): Promise<T | null> => {
  try {
    return JSON.parse(await call('GET', `/store/kv/${encodeURIComponent(key)}`)) as T;
  } catch {
    return null; // not written yet
  }
};
const r2 = (key: string, bytes: Uint8Array, type: string, encoding?: string) =>
  call('PUT', `/store/r2/${key}`, bytes, { 'content-type': type, ...(encoding ? { 'x-content-encoding': encoding } : {}) });

interface JobStatus { at: string; ok: boolean; ms: number; message: string; rows?: number; stations?: number }
type JobName = 'hourly' | 'bulletin' | 'archive' | 'global';
interface Status { hourly?: JobStatus; bulletin?: JobStatus; archive?: JobStatus; global?: JobStatus; failures: number; lastGood?: string }

async function record(job: JobName, s: JobStatus) {
  let status: Status = { failures: 0 };
  try {
    status = (JSON.parse(await call('GET', '/store/kv/ingest:status')) as Status | null) ?? status;
  } catch {
    /* first run */
  }
  status[job] = s;
  if (job === 'hourly') {
    if (s.ok) {
      status.failures = 0;
      status.lastGood = s.at;
    } else status.failures = (status.failures ?? 0) + 1;
  }
  await kv('ingest:status', JSON.stringify(status)).catch((e) => console.error('status write failed', e));
}

/** Runs a job and records it in /health; `quiet` results are not news and leave the last record. */
async function timed<T>(job: JobName, fn: () => Promise<T>, quiet?: (r: T) => boolean): Promise<T> {
  const t0 = Date.now();
  const at = new Date(t0).toISOString();
  try {
    const r = await fn();
    const o = (r ?? {}) as { rows?: number; stations?: number };
    if (!quiet?.(r)) await record(job, { at, ok: true, ms: Date.now() - t0, message: JSON.stringify(r).slice(0, 400), rows: o.rows, stations: o.stations });
    console.log(`${job}: ok in ${Date.now() - t0} ms`, JSON.stringify(r));
    return r;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await record(job, { at, ok: false, ms: Date.now() - t0, message });
    throw e;
  }
}

// ─── Hourly ─────────────────────────────────────────────────────────────

/**
 * Every city the model is asked for: the launch cities plus every bulletin
 * city we hold coordinates for, so the national map stays populated.
 */
function camsSites(): CamsSite[] {
  const sites: CamsSite[] = CITIES.map((c) => ({ slug: c.slug, name: c.en, state: c.state, lat: c.lat, lon: c.lon }));
  const seen = new Set(CITIES.map((c) => bulletinCityKey(c.bulletin)));
  // CITY_COORDS is checked in (@saans/data). It used to come from the D1
  // `stations` table, which only the station feed filled — that table is empty
  // for good now, and reading it would leave the map with 25 dots.
  for (const co of CITY_COORDS) {
    const key = bulletinCityKey(co.city);
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push({ slug: slugForBulletinCity(co.city), name: co.city, state: co.state, lat: co.lat, lon: co.lon });
  }
  return sites;
}

/** Fewer cities than this means a broken response: keep the raw, publish nothing. */
const MIN_CITIES = 20;

async function hourly() {
  const now = new Date();
  const sites = camsSites();
  const responses = await fetchCamsResponses(sites, { userAgent: UA });
  const cams = camsAt(responses, now.getTime());

  // Raw first: exactly what the model said, before any parsing can fail.
  const p = istParts(now);
  const rawKey = `raw/${p.y}/${pad(p.m)}/${pad(p.d)}/${pad(p.h)}${pad(p.mi)}-cams.json.gz`;
  await r2(rawKey, gzipSync(JSON.stringify({ fetchedAt: now.toISOString(), source: 'cams', cities: cams })), 'application/json', 'gzip');

  if (cams.length < MIN_CITIES) throw new Error(`only ${cams.length} cities from CAMS; raw kept at ${rawKey}`);

  // The correction learned from past bulletins (scripts/calibrate.ts). Absent
  // on a cold start, and then the estimate runs ~2x hot until it is built.
  const calibration = (await kvGet<CamsCalibration>('cams:calibration')) ?? {};
  if (!Object.keys(calibration).length) console.log('::warning::no cams:calibration yet — run `node scripts/calibrate.ts`');

  const feedAt = cams.reduce<string | null>((m, c) => (!m || c.at > m ? c.at : m), null);
  const hour = istHour(feedAt ?? now);

  const cityNow: Record<string, CityNow | null> = {};
  for (const c of cams) if (c.slug) cityNow[c.slug] = camsCityNow(c, calibration);

  const today = istDate(now);
  const lastYearDate = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const [hoursRaw, bulls, lyRaw, acc] = await Promise.all([
    read<{ s: string; t: string; aqi: number; u: number | null; n: number }[]>('hours', new Date(Date.parse(hour) - 23 * H).toISOString(), hour),
    read<{ s: string; d: string; aqi: number; p: string; used: number; total: number | null; ours: number | null }[]>('bulletins', addDays(today, -30), today),
    read<{ s: string; d: string; aqi: number }[]>('bulletins', lastYearDate, lastYearDate),
    read<Accuracy & { n: number }>('accuracy'),
  ]);

  // This hour, plus every hour of the last day that no run stored. GitHub's
  // scheduler skips many hourly runs, and each skipped hour used to stay a
  // gap in the 24-hour chart. The response already holds two days of model
  // hours, so a missed hour is scored exactly as its own run would have
  // scored it. Stored hours are never rewritten.
  const stored = new Set(hoursRaw.map((r) => `${r.s}@${r.t}`));
  const toRow = (slug: string, slot: string, n: CityNow) => ({ slug, hour: slot, aqi: n.aqi, min: n.min, max: n.max, valid: n.valid, total: n.total, dominant: n.dominant.join(','), us: n.us });
  const cityRows = CITIES.filter((c) => cityNow[c.slug]).map((c) => toRow(c.slug, hour, cityNow[c.slug]!));
  let filled = 0;
  for (let k = 1; k < 24; k++) {
    const slot = new Date(Date.parse(hour) - k * H).toISOString();
    if (CITIES.every((c) => stored.has(`${c.slug}@${slot}`))) continue;
    // An IST hour starts at :30 UTC; the model hour inside it is 30 min later.
    for (const c of camsAt(responses, Date.parse(slot) + H / 2)) {
      if (!c.slug || stored.has(`${c.slug}@${slot}`) || istHour(c.at) !== slot) continue;
      const n = camsCityNow(c, calibration);
      if (!n) continue;
      cityRows.push(toRow(c.slug, slot, n));
      filled++;
    }
  }
  await d1('city_hour', cityRows);

  const byKey = new Map<string, { s: string; t: string; aqi: number; u: number | null; n: number }>();
  for (const r of hoursRaw) byKey.set(`${r.s}@${r.t}`, r);
  for (const r of cityRows) byKey.set(`${r.slug}@${r.hour}`, { s: r.slug, t: r.hour, aqi: r.aqi, u: r.us, n: r.valid });
  const hours: Record<string, HourPoint[]> = {};
  for (const r of [...byKey.values()].sort((a, b) => a.t.localeCompare(b.t))) (hours[r.s] ??= []).push({ t: r.t, aqi: r.aqi, u: r.u, n: r.n });
  const days: Record<string, DayPoint[]> = {};
  const bulletins: Record<string, BundleBulletin> = {};
  for (const r of bulls) {
    (days[r.s] ??= []).push({ d: r.d, aqi: r.aqi });
    bulletins[r.s] = { date: r.d, aqi: r.aqi, prominent: r.p ? r.p.split(',') : [], used: r.used, total: r.total, url: bulletinUrl(r.d), ours: r.ours };
  }
  const lastYear: Record<string, DayPoint> = {};
  for (const r of lyRaw) lastYear[r.s] = { d: r.d, aqi: r.aqi };
  const bundle = buildBundle({ stations: [], cityNow, cams, calibration, live: 'cams', hours, days, bulletins, lastYear, accuracy: acc?.n ? acc : null, now });
  await kv('bundle:v1', JSON.stringify(bundle));
  return {
    source: 'cams',
    cities: cams.length,
    rows: cityRows.length - filled,
    filled,
    calibrated: Object.keys(calibration).length,
    feedAt,
    raw: rawKey,
  };
}

// ─── 4 PM bulletin ──────────────────────────────────────────────────────
async function bulletin(date: string, final: boolean) {
  const have = await read<{ n: number }>('bulletin_count', date);
  if (have.n > 50) return { status: 'already-stored', date };
  const url = bulletinUrl(date);
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('pdf')) {
    if (final) throw new Error(`bulletin for ${date} not published by 21:00 IST (HTTP ${res.status}, ${type})`);
    return { status: 'not-published', date };
  }
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  const b = parseBulletinText(text, url);
  if (!b || b.date !== date || b.rows.length < 50) throw new Error(`bulletin ${date}: parsed ${b?.rows.length ?? 0} rows for ${b?.date ?? 'no date'} — layout changed?`);

  const ours = await read<Record<string, number>>('ours', istAt(date, 16));
  await d1(
    'bulletin',
    b.rows.map((r) => {
      const slug = slugForBulletinCity(r.city);
      return { key: bulletinCityKey(r.city), date, city: r.city, slug, aqi: r.aqi, category: r.category, prominent: r.prominent.join(','), used: r.used, total: r.total, ours: slug ? (ours[slug] ?? null) : null };
    }),
  );
  const off = b.rows
    .map((r) => ({ slug: slugForBulletinCity(r.city), cpcb: r.aqi }))
    .filter((x): x is { slug: string; cpcb: number } => !!x.slug && ours[x.slug] !== undefined)
    .map((x) => ({ ...x, ours: ours[x.slug]!, delta: (ours[x.slug]! - x.cpcb) / x.cpcb }))
    .filter((x) => Math.abs(x.delta) > 0.1);
  for (const x of off) console.log(`::warning::${date} ${x.slug}: ours ${x.ours} vs CPCB ${x.cpcb} (${(x.delta * 100).toFixed(0)}%)`);

  // The home map's 30-day replay.
  const from = addDays(date, -29);
  const rows = await read<{ c: string; d: string; aqi: number }[]>('bulletins_all', from, date);
  const coords = [...CITY_COORDS];
  const byDate: Record<string, { city: string; aqi: number }[]> = {};
  for (const r of rows) (byDate[r.d] ??= []).push({ city: r.c, aqi: r.aqi });
  const dates = Array.from({ length: 30 }, (_, i) => addDays(from, i));
  const replay = buildReplay(dates, byDate, coordLookup(coords));
  await kv('replay:30d', JSON.stringify(replay));
  return { status: 'stored', date, cities: b.rows.length, offBy10: off.length, replayCities: replay.cities.length };
}

// ─── Nightly archive ────────────────────────────────────────────────────
function csv(rows: Record<string, unknown>[], cols: string[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

async function archive(date: string) {
  const start = Date.parse(istAt(date, 0));
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 4; i++) {
    const a = new Date(start + i * 6 * H).toISOString();
    const b = new Date(start + (i + 1) * 6 * H).toISOString();
    rows.push(...(await read<Record<string, unknown>[]>('day', a, b)));
  }
  const cols = ['hour_utc', 'station_id', 'station', 'city', 'state', 'lat', 'lon', ...POLLUTANTS, 'lo', 'hi', 'flags', 'aqi', 'us', 'dominant', 'valid'];
  const [y, m, d] = date.split('-');
  await r2(`archive/${y}/${m}/${d}.csv.gz`, gzipSync(csv(rows, cols)), 'text/csv', 'gzip');
  const brows = await read<Record<string, unknown>[]>('day_bulletin', date);
  if (brows.length) {
    const bcols = ['date', 'city', 'city_slug', 'aqi', 'category', 'prominent', 'used', 'total', 'ours'];
    await r2(`bulletin/${y}/${m}/${d}.csv`, new TextEncoder().encode(csv(brows, bcols)), 'text/csv');
  }
  return { date, stationRows: rows.length, bulletinRows: brows.length };
}

// ─── The world estimate (packages/pipeline/src/global.ts) ────────────────
/** CAMS issues two runs a day; four refreshes never miss one and stay inside Open-Meteo's free tier. */
const GLOBAL_EVERY_MS = 5.5 * H;

async function global() {
  const responses = await fetchGlobalResponses(undefined, { userAgent: UA });
  const bundle = buildGlobal(responses);
  const cities = Object.keys(bundle.cities).length;
  if (cities < 100) throw new Error(`global: only ${cities} cities scored; keeping the previous bundle`);
  const body = JSON.stringify(bundle);
  await kv(GLOBAL_KEY, body);
  return { cities, t0: bundle.t0, kb: Math.round(body.length / 1024) };
}

// ─── Entry ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(Boolean);
const job = args[0] ?? 'auto';
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const nowMs = Date.now();
const istHourNow = istParts(nowMs).h;
const today = istDate(nowMs);

let failed = false;
const attempt = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    failed = true;
    console.error(`::error::${name} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// The 4 PM bulletin appears around 17:00 IST. It runs before the hourly job so
// that job's bundle already carries it. Scheduled runs are unreliable, so an
// automatic run never assumes the previous one happened: from 17:00 it tries
// today's bulletin (an error from 21:00 if CPCB still has not published), and
// before 17:00 it picks up yesterday's if no evening run stored it. Each try
// costs one read once the bulletin is stored.
if (job === 'bulletin') {
  await attempt('bulletin', () => timed('bulletin', () => bulletin(dateArg ?? today, false)));
} else if (job === 'auto') {
  const evening = istHourNow >= 17;
  const date = evening ? today : addDays(today, -1);
  await attempt('bulletin', () => timed('bulletin', () => bulletin(date, evening && istHourNow >= 21), (r) => r.status === 'already-stored'));
}
if (job === 'hourly' || job === 'auto') await attempt('hourly', () => timed('hourly', () => hourly()));
if (job === 'global') {
  await attempt('global', () => timed('global', () => global()));
} else if (job === 'auto') {
  const status = await kvGet<Status>('ingest:status');
  const last = status?.global?.ok ? Date.parse(status.global.at) : 0;
  // A failed world refresh must not fail India's hourly run: the world bundle covers
  // 48 hours ahead, so the next run catches up. It shows in /health and as a warning.
  if (nowMs - last > GLOBAL_EVERY_MS) {
    await timed('global', () => global()).catch((e) => console.warn(`::warning::global failed: ${e instanceof Error ? `${e.message}${e.cause ? ` (cause: ${String((e.cause as Error).message ?? e.cause)})` : ''}` : String(e)}`));
  }
}
// Yesterday's archive, on the first automatic run of the IST day that finds it missing.
if (job === 'archive') {
  await attempt('archive', () => timed('archive', () => archive(dateArg ?? addDays(today, -1))));
} else if (job === 'auto') {
  const yesterday = addDays(today, -1);
  const status = await kvGet<Status>('ingest:status');
  const last = (() => {
    try {
      return (JSON.parse(status?.archive?.message ?? '{}') as { date?: string }).date ?? '';
    } catch {
      return '';
    }
  })();
  if (last < yesterday) await attempt('archive', () => timed('archive', () => archive(yesterday)));
}
process.exit(failed ? 1 : 0);
