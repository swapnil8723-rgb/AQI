import { CITIES } from '@saans/data';
import {
  buildBundle,
  bulletinUrl,
  camsCityNow,
  fetchCams,
  istDate,
  istHour,
  istParts,
  type CamsCalibration,
  type CamsSite,
  type CityNow,
} from '@saans/pipeline';
import { accuracy, bulletinDays, cityHours, lastYearBulletins, latestBulletins, writeCityHours } from './db.ts';
import { BUNDLE_KEY, CALIBRATION_KEY, userAgent, type Env } from './env.ts';

/** Fewer cities than this means a broken response: archive it, publish nothing. */
export const MIN_CITIES = 20;

const pad = (n: number) => String(n).padStart(2, '0');

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Raw first: store exactly what the API returned, before any parsing can fail. */
async function archiveRaw(env: Env, at: Date, records: unknown[], source: string): Promise<string> {
  const p = istParts(at);
  const key = `raw/${p.y}/${pad(p.m)}/${pad(p.d)}/${pad(p.h)}${pad(p.mi)}-${source}.json.gz`;
  await env.ARCHIVE.put(key, await gzip(JSON.stringify({ fetchedAt: at.toISOString(), source, records })), {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
  });
  return key;
}

export interface HourlyResult {
  source: 'cams';
  cities: number;
  rows: number;
  calibrated: number;
  feedAt: string | null;
  raw: string;
}

/**
 * The hourly job: fetch → archive raw → score → D1 → KV bundle.
 *
 * The live estimate comes from CAMS (packages/pipeline/src/cams.ts) because
 * CPCB's machine-readable feed went down in Sep 2026 and every free
 * redistributor of it went down too. The official daily figure is still
 * CPCB's bulletin, handled by bulletin.ts. `cities` lets a caller supply
 * sites; by default the launch cities are used.
 *
 * On the Workers Free plan this is dormant — the same job runs in GitHub
 * Actions (scripts/ingest-run.ts), which also covers the whole map.
 */
export async function hourly(env: Env, sites?: CamsSite[]): Promise<HourlyResult> {
  const now = new Date();
  const use: CamsSite[] = sites ?? CITIES.map((c) => ({ slug: c.slug, name: c.en, state: c.state, lat: c.lat, lon: c.lon }));
  const cams = await fetchCams(use, { userAgent: userAgent(env), now: now.getTime() });
  const raw = await archiveRaw(env, now, cams, 'cams');

  if (cams.length < MIN_CITIES) throw new Error(`only ${cams.length} cities from CAMS; raw kept at ${raw}`);

  const calibration = ((await env.KV.get(CALIBRATION_KEY, 'json')) as CamsCalibration | null) ?? {};
  const feedAt = cams.reduce<string | null>((m, c) => (!m || c.at > m ? c.at : m), null);
  const hour = istHour(feedAt ?? now);

  const nows: Record<string, CityNow | null> = {};
  for (const c of cams) if (c.slug) nows[c.slug] = camsCityNow(c, calibration);
  for (const c of CITIES) nows[c.slug] ??= null;
  await writeCityHours(env.DB, hour, nows);

  const today = istDate(now);
  const stations: never[] = [];

  const [hours, days, bulletins, acc, lastYear] = await Promise.all([
    cityHours(env.DB, hour),
    bulletinDays(env.DB, today),
    latestBulletins(env.DB, bulletinUrl),
    accuracy(env.DB),
    lastYearBulletins(env.DB, today),
  ]);
  const bundle = buildBundle({ stations, cityNow: nows, cams, calibration, live: 'cams', hours, days, bulletins, lastYear, accuracy: acc, now });
  await env.KV.put(BUNDLE_KEY, JSON.stringify(bundle));

  return {
    source: 'cams',
    cities: cams.length,
    rows: Object.values(nows).filter(Boolean).length,
    calibrated: Object.keys(calibration).length,
    feedAt,
    raw,
  };
}
