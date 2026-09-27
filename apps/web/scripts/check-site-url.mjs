// Refuse to deploy without a real public origin: canonicals, hreflang and the
// sitemap are built from SITE_URL, and a localhost origin would poison them.
const url = process.env.SITE_URL;
if (!url || !/^https:\/\/[^/]+$/.test(url) || /localhost|127\.0\.0\.1/.test(url)) {
  console.error('\n  SITE_URL must be set to the public origin, e.g. SITE_URL=https://saans.in (https, no trailing slash).\n');
  process.exit(1);
}
console.log(`SITE_URL = ${url}`);
