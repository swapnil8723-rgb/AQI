/**
 * Smoke test every route against a running server (dev, preview or live).
 *
 *   node scripts/smoke.ts [http://127.0.0.1:4321]
 *
 * Checks status codes, redirects, that city pages carry the "Live estimate"
 * label, that "Official" appears only beside the CPCB bulletin (DESIGN.md §7),
 * hreflang pairs, and JSON endpoints.
 */
import { CITIES } from '@saans/data';

const base = (process.argv[2] ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
let failed = 0;
const fail = (msg: string) => {
  failed++;
  console.log(`  ✗ ${msg}`);
};

async function get(path: string, init?: RequestInit) {
  const t0 = Date.now();
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  const body = res.status < 300 ? await res.text() : '';
  return { res, body, ms: Date.now() - t0 };
}

const pages = ['/', '/hi', '/aqi-explained', '/hi/aqi-explained', '/about', '/hi/about', '/privacy', '/hi/privacy'];
for (const c of CITIES.filter((x) => x.live)) pages.push(`/aqi/${c.slug}`, `/hi/aqi/${c.slug}`);

for (const p of pages) {
  const { res, body, ms } = await get(p);
  const kb = (body.length / 1024).toFixed(0);
  if (res.status !== 200) {
    fail(`${p} → ${res.status}`);
    continue;
  }
  const problems: string[] = [];
  if (!/<link rel="alternate" hreflang="hi-IN"/.test(body)) problems.push('no hreflang');
  if (!/<link rel="canonical"/.test(body)) problems.push('no canonical');
  if (/undefined|NaN|\[object Object\]/.test(body.replace(/<script[\s\S]*?<\/script>/g, ''))) problems.push('undefined/NaN in HTML');
  if (p.includes('/aqi/')) {
    if (!/Live estimate|लाइव अनुमान/.test(body)) problems.push('no "Live estimate" label');
    // "Official" only next to the bulletin value (and in explanatory copy about it).
    const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    const official = text.match(/[^.]{0,40}(Official|आधिकारिक)[^.]{0,40}/g) ?? [];
    for (const o of official) if (!/CPCB|bulletin|बुलेटिन/.test(o)) problems.push(`"Official" without CPCB: ${o.trim()}`);
  }
  if (problems.length) fail(`${p}: ${problems.join('; ')}`);
  else console.log(`  ✓ ${p} ${ms} ms ${kb} KB`);
}

const redirects: [string, string][] = [
  ['/aqi/gurgaon', '/aqi/gurugram'],
  ['/aqi/bangalore', '/aqi/bengaluru'],
  ['/aqi/Delhi', '/aqi/delhi'],
  ['/hi/aqi/bombay', '/hi/aqi/mumbai'],
  ['/search?q=gurgaon', '/aqi/gurugram'],
  ['/search?q=%E0%A4%A6%E0%A4%BF%E0%A4%B2%E0%A5%8D%E0%A4%B2%E0%A5%80', '/aqi/delhi'],
];
for (const [from, to] of redirects) {
  const { res } = await get(from);
  const loc = res.headers.get('location') ?? '';
  if (res.status < 300 || res.status >= 400 || !loc.endsWith(to)) fail(`${from} → ${res.status} ${loc} (want ${to})`);
  else console.log(`  ✓ ${from} → ${res.status} ${to}`);
}

for (const p of ['/aqi/atlantis', '/nope']) {
  const { res } = await get(p);
  if (res.status !== 404) fail(`${p} → ${res.status}, want 404`);
  else console.log(`  ✓ ${p} → 404`);
}

for (const p of ['/api/stations.json', '/api/stations/delhi.geojson', '/api/here', '/api/search.json', '/api/replay.json', '/replay/diwali-2025.json', '/sitemap.xml', '/robots.txt']) {
  const { res, body } = await get(p);
  if (res.status !== 200 || body.length < 20) fail(`${p} → ${res.status}`);
  else console.log(`  ✓ ${p} ${(body.length / 1024).toFixed(0)} KB`);
}

console.log(failed ? `\n${failed} problem(s)` : '\nall good');
process.exit(failed ? 1 : 0);
