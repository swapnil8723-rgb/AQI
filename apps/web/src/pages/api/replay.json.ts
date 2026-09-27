/**
 * GET /api/replay.json — CPCB's official daily AQI for every city over the
 * last 30 days (the home map's replay). Written to KV by saans-ingest after
 * each 4 PM bulletin.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async () => {
  const data = env.KV ? await env.KV.get<unknown>('replay:30d', { type: 'json', cacheTtl: 300 }) : null;
  return new Response(JSON.stringify(data ?? { v: 1, dates: [], cities: [] }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=900, s-maxage=3600', 'x-robots-tag': 'noindex' },
  });
};
