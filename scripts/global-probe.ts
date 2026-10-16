/**
 * The world estimate without storing it: for a quick look, a local dev copy, or
 * a one-off seed of the Worker's KV.
 *
 *   node scripts/global-probe.ts paris london       print a few cities
 *   node scripts/global-probe.ts --out global.json   every city, written to a file
 *
 * Seed KV from the file (needs `wrangler login`):
 *   npx wrangler kv key put global:v1 --path global.json --binding KV --remote   (from workers/ingest)
 */
import { writeFileSync } from 'node:fs';
import { WORLD_CITIES, worldKey } from '@saans/data';
import { buildGlobal, fetchGlobalResponses, globalNow, globalSeries } from '@saans/pipeline';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const want = args.filter((a, i) => a !== '--out' && args[i - 1] !== '--out');
const sites = out ? WORLD_CITIES : WORLD_CITIES.filter((c) => want.includes(c.slug));
const g = buildGlobal(await fetchGlobalResponses(sites, { pauseMs: out ? 12_000 : 0, userAgent: 'GlobalMetrics/1.0 (contact support@risescribe.com)' }));
if (out) {
  writeFileSync(out, JSON.stringify(g));
  console.log(`${out}: ${Object.keys(g.cities).length} of ${sites.length} cities, t0 ${g.t0}`);
} else {
  for (const c of sites) {
    const n = globalNow(g, worldKey(c));
    console.log(c.name, c.country, JSON.stringify(n), 'next 24 h:', globalSeries(g, worldKey(c), 1, 24).map((p) => p.aqi).join(' '));
  }
}
