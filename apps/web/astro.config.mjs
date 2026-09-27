// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Public origin for canonicals, hreflang and the sitemap: SITE_URL at build
// time, else src/lib/site.ts. Never derived from a platform variable.
import { SITE } from './src/lib/site.ts';

/**
 * Two hosts, one codebase (README → Deploy):
 * - Cloudflare Workers (default): data from the KV binding.
 * - Vercel (auto-detected from VERCEL=1, or DEPLOY_TARGET=vercel): the same
 *   data read over HTTPS from the ingest Worker (src/lib/vercel-runtime.ts
 *   stands in for `cloudflare:workers`).
 */
const target = process.env.DEPLOY_TARGET ?? (process.env.VERCEL ? 'vercel' : 'cloudflare');
const adapter =
  target === 'vercel'
    ? (await import('@astrojs/vercel')).default()
    : (await import('@astrojs/cloudflare')).default({
        // No raster images to optimise; keeps the IMAGES binding out.
        imageService: 'passthrough',
      });

export default defineConfig({
  site: process.env.SITE_URL || SITE.origin,
  output: 'server',
  adapter,
  session: false,
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  prefetch: false,
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
  vite: {
    plugins: [tailwindcss()],
    resolve:
      target === 'vercel'
        ? { alias: { 'cloudflare:workers': fileURLToPath(new URL('./src/lib/vercel-runtime.ts', import.meta.url)) } }
        : {},
  },
});
