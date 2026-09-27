import { env } from 'cloudflare:workers';
import type { Bundle } from '@saans/pipeline';

export type { Bundle, CityBundle, BundleStation, CityNow, HourPoint, DayPoint, MapCity, LiteStation, BundleBulletin } from '@saans/pipeline';

/**
 * The hourly bundle written by saans-ingest. Parsed once per isolate and
 * reused for 60 s: isolates serve many requests, so most renders skip both
 * the KV read and the JSON parse (the free plan's CPU budget is 10 ms).
 */
let memo: { at: number; value: Bundle | null } | null = null;
const TTL_MS = 60_000;

export async function getBundle(): Promise<Bundle | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  let value: Bundle | null = null;
  try {
    const kv = env.KV;
    value = kv ? await kv.get<Bundle>('bundle:v1', { type: 'json', cacheTtl: 60 }) : null;
  } catch (e) {
    console.error('bundle read failed', e);
    // Keep serving the last good bundle rather than failing the page.
    if (memo?.value) return memo.value;
  }
  memo = { at: Date.now(), value };
  return value;
}
