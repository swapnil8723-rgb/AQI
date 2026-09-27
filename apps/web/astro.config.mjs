// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// Public origin for canonicals, hreflang and the sitemap: SITE_URL at build
// time, else src/lib/site.ts. Never derived from a platform variable.
import { SITE } from './src/lib/site.ts';

export default defineConfig({
  site: process.env.SITE_URL || SITE.origin,
  output: 'server',
  adapter: cloudflare({
    // No raster images to optimise; keeps the IMAGES binding out.
    imageService: 'passthrough',
  }),
  session: false,
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Small pages: inline the CSS so first paint needs one request.
    inlineStylesheets: 'auto',
  },
  prefetch: false,
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
  vite: {
    plugins: [tailwindcss()],
  },
});
