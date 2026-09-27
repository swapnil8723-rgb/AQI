/**
 * GET /api/search.json — the search palette's second tier, fetched when the
 * palette first opens: every station in a launch city (→ its row on the city
 * page) and every other CPCB city (→ the home map, zoomed there).
 */
import type { APIRoute } from 'astro';
import { CITIES, haversineKm } from '@saans/data';
import { getBundle } from '../../lib/bundle.ts';

export const GET: APIRoute = async () => {
  const b = await getBundle();
  const stations = CITIES.filter((c) => c.live).flatMap((c) =>
    (b?.cities[c.slug]?.stations ?? []).map((s) => ({ p: s.place, c: c.slug, h: s.anchor, q: s.valid ? s.aqi : null, u: s.valid ? s.us : null })),
  );
  const others = (b?.map ?? [])
    .filter((m) => m.slug === null)
    .map((m) => {
      let near: { slug: string; km: number } | null = null;
      for (const c of CITIES) {
        if (!c.live) continue;
        const km = haversineKm(m.lat, m.lon, c.lat, c.lon);
        if (!near || km < near.km) near = { slug: c.slug, km };
      }
      return { n: m.name, st: m.state, la: m.lat, lo: m.lon, q: m.aqi, near: near && near.km < 120 ? near.slug : null };
    });
  return new Response(JSON.stringify({ stations, others }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600, s-maxage=600', 'x-robots-tag': 'noindex' },
  });
};
