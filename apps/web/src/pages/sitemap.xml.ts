/**
 * One sitemap, EN + HI with hreflang pairs (PLAN.md §8). Only live cities
 * with recent data; lastmod is the date the data last changed.
 */
import type { APIRoute } from 'astro';
import { CITIES } from '@saans/data';
import { istDate } from '@saans/pipeline';
import { getBundle } from '../lib/bundle.ts';
import { localePath } from '../i18n/index.ts';

export const GET: APIRoute = async ({ site }) => {
  const b = await getBundle();
  const today = istDate(b?.generatedAt ?? Date.now());
  const fresh = (slug: string) => {
    const at = b?.cities[slug]?.now?.at;
    return at && Date.now() - Date.parse(at) < 72 * 3600_000;
  };
  const paths: { path: string; lastmod: string }[] = [
    { path: '/', lastmod: today },
    ...CITIES.filter((c) => c.live && fresh(c.slug)).map((c) => ({ path: `/aqi/${c.slug}`, lastmod: today })),
    { path: '/aqi-explained', lastmod: '2026-09-27' },
    { path: '/about', lastmod: today },
    { path: '/privacy', lastmod: '2026-09-27' },
  ];
  const url = (lang: 'en' | 'hi', p: string) => new URL(localePath(lang, p), site).href;
  const body = paths
    .flatMap(({ path, lastmod }) =>
      (['en', 'hi'] as const).map(
        (lang) => `  <url>
    <loc>${url(lang, path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <xhtml:link rel="alternate" hreflang="en-IN" href="${url('en', path)}"/>
    <xhtml:link rel="alternate" hreflang="hi-IN" href="${url('hi', path)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${url('en', path)}"/>
  </url>`,
      ),
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } },
  );
};
