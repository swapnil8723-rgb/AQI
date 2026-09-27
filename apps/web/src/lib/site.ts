/**
 * Brand and origin. "Saans" is the working name (PLAN.md header) — change it
 * here and in public/ icons before launch.
 *
 * The public origin comes from SITE_URL at build time (astro.config.mjs). The
 * localhost fallback is deliberate: a production build without SITE_URL fails
 * in scripts/check-site-url.mjs rather than shipping canonicals to a domain we
 * may not own.
 */
export const SITE = {
  name: 'Saans',
  nameHi: 'साँस',
  origin: 'http://localhost:4321',
  contact: 'support@risescribe.com',
  tagline: {
    en: 'See exactly where the number comes from.',
    hi: 'जानिए यह नंबर कहाँ से आया।',
  },
} as const;
