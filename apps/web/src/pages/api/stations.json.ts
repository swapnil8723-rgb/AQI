/**
 * GET /api/stations.json — every CPCB station with its live AQI, for the
 * client-side nearest-station search (coordinates never leave the browser).
 */
import type { APIRoute } from 'astro';
import { getBundle } from '../../lib/bundle.ts';

export const GET: APIRoute = async () => {
  const b = await getBundle();
  return new Response(JSON.stringify({ feedAt: b?.feedAt ?? null, stations: b?.stations ?? [] }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300, s-maxage=600',
      'x-robots-tag': 'noindex',
    },
  });
};
