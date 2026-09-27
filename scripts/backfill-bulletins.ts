/**
 * Backfill CPCB's official daily city AQI from the 4 PM bulletin PDFs, which
 * are online back to 2015 (checked 27 Sep 2026). This gives the "Last 30 days"
 * strip, history pages and "Diwali this year vs last year" real, official data
 * from launch day instead of waiting months for our own archive to grow.
 *
 *   node scripts/backfill-bulletins.ts 2025-09-01 2026-09-26
 *   npx wrangler d1 execute saans --remote --file=.cache/backfill/bulletins.sql   (from workers/ingest)
 *
 * Downloads are cached in .cache/bulletin and fetched one at a time with a
 * pause, naming us in the User-Agent. Writes:
 *   .cache/backfill/bulletins.sql   INSERT OR REPLACE rows for the D1 `bulletin` table
 *   .cache/backfill/bulletins.json  { date: rows[] } for the local fixture
 *   .cache/backfill/report.txt      per-day row counts and failures
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, bulletinCityKey, slugForBulletinCity, type Bulletin } from '@saans/pipeline';
import { CACHE, loadBulletin } from './lib/archive.ts';

const [from = '2025-09-01', to = addDays(new Date().toISOString().slice(0, 10), -1)] = process.argv.slice(2);
const out = join(CACHE, 'backfill');
mkdirSync(out, { recursive: true });

const sqlStr = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);
const sqlNum = (v: number | null) => (v === null || !Number.isFinite(v) ? 'NULL' : String(v));

const jsonPath = join(out, 'bulletins.json');
const all: Record<string, Bulletin['rows']> = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : {};
const report: string[] = [];
let days = 0;
let rows = 0;
const missing: string[] = [];

for (let d = from; d <= to; d = addDays(d, 1)) {
  const cached = existsSync(join(CACHE, 'bulletin', `AQI_Bulletin_${d.replaceAll('-', '')}.pdf`));
  let b: Bulletin | null = null;
  try {
    b = await loadBulletin(d);
  } catch (e) {
    report.push(`${d} error ${String(e)}`);
  }
  if (!b || !b.rows.length) {
    missing.push(d);
    report.push(`${d} missing`);
  } else {
    if (b.date !== d) report.push(`${d} WARNING pdf says ${b.date}`);
    all[d] = b.rows;
    days++;
    rows += b.rows.length;
    report.push(`${d} ${b.rows.length} cities${b.absent.length ? `, ${b.absent.length} absent` : ''}`);
  }
  if (!cached) await new Promise((r) => setTimeout(r, 400));
  if (days % 30 === 0 && days) process.stdout.write(`\r${d}: ${days} days, ${rows} rows`);
}

const lines: string[] = [];
for (const [date, list] of Object.entries(all).sort()) {
  for (const r of list) {
    lines.push(
      `INSERT OR REPLACE INTO bulletin (city_key, date, city, city_slug, aqi, category, prominent, used, total, ours) VALUES (` +
        [
          sqlStr(bulletinCityKey(r.city)),
          sqlStr(date),
          sqlStr(r.city),
          sqlStr(slugForBulletinCity(r.city)),
          sqlNum(r.aqi),
          sqlStr(r.category),
          sqlStr(r.prominent.join(',')),
          sqlNum(r.used),
          sqlNum(r.total),
          'NULL',
        ].join(', ') +
        `);`,
    );
  }
}
writeFileSync(join(out, 'bulletins.sql'), lines.join('\n') + '\n');
writeFileSync(jsonPath, JSON.stringify(all));
writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
console.log(`\n${days} bulletins, ${rows} city-days (${lines.length} SQL rows in total). Missing: ${missing.length ? missing.join(', ') : 'none'}`);
