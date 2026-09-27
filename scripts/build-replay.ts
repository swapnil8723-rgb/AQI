/**
 * Static replays for the home map's "watch the air" player — past windows
 * never change, so they ship as static assets (served free, no Worker call).
 *
 *   node scripts/build-replay.ts   → apps/web/public/replay/diwali-2025.json
 *
 * Needs .cache/backfill/bulletins.json (scripts/backfill-bulletins.ts) and
 * .cache/city-coords.json (scripts/fixture.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, buildReplay, coordLookup, type BulletinRow, type CityCoord } from '@saans/pipeline';
import { CACHE } from './lib/archive.ts';

const bulletins = JSON.parse(readFileSync(join(CACHE, 'backfill', 'bulletins.json'), 'utf8')) as Record<string, BulletinRow[]>;
const coords = JSON.parse(readFileSync(join(CACHE, 'city-coords.json'), 'utf8')) as CityCoord[];
const lookup = coordLookup(coords);

/** Diwali (Lakshmi Puja) fell on 20 Oct 2025. */
const WINDOWS = [{ file: 'diwali-2025.json', from: '2025-10-10', to: '2025-11-05', mark: { date: '2025-10-20', label: 'Diwali' } }];

const outDir = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'replay');
mkdirSync(outDir, { recursive: true });
for (const w of WINDOWS) {
  const dates: string[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) dates.push(d);
  const missing = dates.filter((d) => !bulletins[d]);
  const replay = buildReplay(dates, bulletins as Record<string, { city: string; aqi: number }[]>, lookup, w.mark);
  writeFileSync(join(outDir, w.file), JSON.stringify(replay));
  const delhi = replay.cities.find((c) => c.s === 'delhi');
  console.log(`${w.file}: ${replay.cities.length} cities × ${dates.length} days, ${(JSON.stringify(replay).length / 1024).toFixed(0)} KB; missing days: ${missing.length ? missing.join(', ') : 'none'}; Delhi ${delhi?.v.join(' ')}`);
}
