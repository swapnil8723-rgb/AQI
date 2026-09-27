import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nDisallow: /api/\nDisallow: /search\nDisallow: /hi/search\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
