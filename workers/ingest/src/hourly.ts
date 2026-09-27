import { CITIES } from '@saans/data';
import {
  applySpikeRule,
  buildBundle,
  buildStations,
  bulletinUrl,
  fetchFeed,
  istDate,
  istHour,
  istParts,
  parseFeedRecords,
  type CityNow,
} from '@saans/pipeline';
import { accuracy, bulletinDays, cityHours, latestBulletins, previousReadings, writeCityHours, writeStationHours } from './db.ts';
import { BUNDLE_KEY, userAgent, type Env } from './env.ts';

/** Fewer usable rows than this means a broken or partial feed: archive it, publish nothing. */
export const MIN_ROWS = 1000;

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
  rows: number;
  rejected: number;
  stations: number;
  valid: number;
  feedAt: string | null;
  raw: string;
}

/**
 * The hourly job: fetch → archive raw → parse → flag → D1 → KV bundle.
 * `records` lets the push endpoint (POST /ingest) supply rows fetched
 * elsewhere, if data.gov.in ever stops answering Cloudflare's IPs.
 */
export async function hourly(env: Env, records?: unknown[]): Promise<HourlyResult> {
  const now = new Date();
  const source = records ? 'push' : 'api';
  if (!records) {
    if (!env.DATA_GOV_IN_KEY) throw new Error('DATA_GOV_IN_KEY is not set');
    records = (await fetchFeed({ apiKey: env.DATA_GOV_IN_KEY, userAgent: userAgent(env), deadlineMs: 180_000 })).records;
  }
  const raw = await archiveRaw(env, now, records, source);

  const parsed = parseFeedRecords(records);
  if (parsed.rows.length < MIN_ROWS) {
    throw new Error(`only ${parsed.rows.length} usable rows (rejected ${parsed.rejected}); raw kept at ${raw}`);
  }
  let stations = buildStations(parsed.rows);
  const feedAt = stations.reduce<string | null>((m, s) => (s.updatedAt && (!m || s.updatedAt > m) ? s.updatedAt : m), null);
  const hour = istHour(feedAt ?? now);
  stations = applySpikeRule(stations, await previousReadings(env.DB, hour), feedAt ? Date.parse(feedAt) : null);

  const today = istDate(now);
  await writeStationHours(env.DB, stations, today);

  // Build once to get each launch city's live estimate, store it, then rebuild with history.
  const first = buildBundle({ stations, now });
  const nows: Record<string, CityNow | null> = {};
  for (const c of CITIES) nows[c.slug] = first.cities[c.slug]?.now ?? null;
  await writeCityHours(env.DB, hour, nows);

  const [hours, days, bulletins, acc] = await Promise.all([
    cityHours(env.DB, hour),
    bulletinDays(env.DB, today),
    latestBulletins(env.DB, bulletinUrl),
    accuracy(env.DB),
  ]);
  const bundle = buildBundle({ stations, hours, days, bulletins, accuracy: acc, now });
  await env.KV.put(BUNDLE_KEY, JSON.stringify(bundle));

  return {
    rows: parsed.rows.length,
    rejected: parsed.rejected,
    stations: stations.length,
    valid: stations.filter((s) => s.valid).length,
    feedAt,
    raw,
  };
}
