/**
 * Stand-in for the `cloudflare:workers` module when the site is built for
 * Vercel (astro.config.mjs aliases it here). The hourly data still comes from
 * the Cloudflare ingest Worker — the archive needs hourly cron, which Vercel
 * Hobby does not offer — read over HTTPS from its public /v1/*.json endpoints
 * instead of a KV binding. Set SAANS_DATA_URL to the Worker's origin.
 */

const DATA_URL = (process.env.SAANS_DATA_URL ?? '').replace(/\/$/, '');
const PATHS: Record<string, string> = { 'bundle:v1': '/v1/bundle.json', 'replay:30d': '/v1/replay.json' };

const kv = {
  async get<T = unknown>(key: string, options?: { type?: 'json' | 'text'; cacheTtl?: number }): Promise<T | null> {
    const path = PATHS[key];
    if (!DATA_URL || !path) return null;
    const res = await fetch(DATA_URL + path, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (options?.type === 'json' ? await res.json() : await res.text()) as T;
  },
};

export const env: { KV?: typeof kv; ADSENSE_CLIENT?: string; CF_BEACON_TOKEN?: string; GOOGLE_SITE_VERIFICATION?: string; [key: string]: unknown } = {
  KV: DATA_URL ? kv : undefined,
  ADSENSE_CLIENT: process.env.ADSENSE_CLIENT,
  CF_BEACON_TOKEN: process.env.CF_BEACON_TOKEN,
  GOOGLE_SITE_VERIFICATION: process.env.GOOGLE_SITE_VERIFICATION,
};
