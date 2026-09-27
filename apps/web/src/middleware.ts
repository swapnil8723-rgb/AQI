/**
 * Edge caching and security headers (PLAN.md §2).
 *
 * Worker responses are not cached by Cloudflare's CDN on their own, so HTML
 * goes through the Cache API: one render per URL per 10 minutes per data
 * centre, then served from cache (the data only changes hourly). Pages are
 * identical for every visitor — theme, scale and city live in the browser —
 * so the URL is the whole cache key.
 */
import { defineMiddleware } from 'astro:middleware';

const EDGE_TTL = 600;
const BROWSER_TTL = 60;
const NO_CACHE = /^\/(api\/here|search|hi\/search)/;

const SECURITY: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(self), camera=(), microphone=(), interest-cohort=()',
  'x-frame-options': 'SAMEORIGIN',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const cacheable = request.method === 'GET' && !NO_CACHE.test(url.pathname) && !url.search && !import.meta.env.DEV;
  const cache = cacheable && typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;

  if (cache) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
  }

  const res = await next();
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);

  const type = out.headers.get('content-type') ?? '';
  if (cacheable && out.status === 200 && (type.includes('text/html') || type.includes('xml') || type.includes('text/plain'))) {
    // s-maxage alone is enough on Vercel (its CDN caches function responses);
    // on Cloudflare the Cache API below does the caching.
    out.headers.set('cache-control', `public, max-age=${BROWSER_TTL}, s-maxage=${EDGE_TTL}, stale-while-revalidate=1800`);
    if (cache) {
      const stored = out.clone();
      stored.headers.set('cache-control', `public, max-age=${EDGE_TTL}`);
      const put = cache.put(request.url, stored);
      const ctx = (context.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
      if (ctx) ctx.waitUntil(put);
      else await put;
    }
  } else if (!out.headers.has('cache-control')) {
    out.headers.set('cache-control', 'no-store');
  }
  return out;
});
