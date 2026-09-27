/**
 * GET /api/here — the nearest launch city to the visitor's IP location
 * (PLAN.md §5.3 C step 3). Uses Cloudflare's request.cf only for this
 * response: nothing is logged or stored, and the answer is never cached.
 */
import type { APIRoute } from 'astro';
import { nearestCity } from '@saans/data';

export const GET: APIRoute = ({ request }) => {
  const cf = (request as Request & { cf?: { latitude?: string; longitude?: string; country?: string } }).cf;
  const lat = Number(cf?.latitude);
  const lon = Number(cf?.longitude);
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || cf?.country !== 'IN') {
    return new Response(JSON.stringify({ slug: null }), { headers });
  }
  const n = nearestCity(lat, lon);
  // An IP 300 km from every covered city is not "your city".
  return new Response(JSON.stringify({ slug: n && n.km < 150 ? n.city.slug : null, approximate: true }), { headers });
};
