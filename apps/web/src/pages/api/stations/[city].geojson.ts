/** GET /api/stations/{city}.geojson — a city's stations (PLAN.md §5.3 B data source). */
import type { APIRoute } from 'astro';
import { CITY_BY_SLUG } from '@saans/data';
import { getBundle } from '../../../lib/bundle.ts';

export const GET: APIRoute = async ({ params }) => {
  const slug = (params.city ?? '').toLowerCase();
  if (!CITY_BY_SLUG.get(slug)?.live) return new Response('not found', { status: 404 });
  const b = await getBundle();
  const features = (b?.cities[slug]?.stations ?? []).map((s) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { id: s.id, anchor: s.anchor, name: s.place, agency: s.agency, aqi: s.aqi, us: s.us, dominant: s.dominant, at: s.at, valid: s.valid },
  }));
  return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
    headers: { 'content-type': 'application/geo+json', 'cache-control': 'public, max-age=300, s-maxage=600', 'x-robots-tag': 'noindex' },
  });
};
