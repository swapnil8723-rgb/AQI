/**
 * Builds packages/data/src/world-cities.json: the cities the global estimate
 * covers, from GeoNames (CC BY 4.0).
 *
 *   node scripts/build-world-cities.ts <dir with cities15000.txt, countryInfo.txt, admin1CodesASCII.txt>
 *
 * Download the three files from https://download.geonames.org/export/dump/
 * (unzip cities15000.zip). India is left out: its cities come from the CPCB
 * pipeline (packages/data/src/cities.ts and city-coords.ts).
 *
 * Selection, per country: its largest city, its capital, and every city of
 * at least MIN_POP people, capped at PER_COUNTRY so one country cannot crowd
 * the list. The size is set by the Open-Meteo budget: ~550 cities refreshed
 * four times a day is ~2,200 calls, beside ~6,700 for the Indian hourly job,
 * under the free tier's 10,000 a day (packages/pipeline/src/global.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_POP = 600_000;
const PER_COUNTRY = 25;
/** Countries and territories smaller than this are left out (search demand, call budget). */
const MIN_COUNTRY_POP = 1_000_000;

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-world-cities.ts <geonames dir>');

const tsv = (file: string) =>
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'));

export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

// countryInfo.txt: ISO, ISO3, ISO-numeric, fips, Country, Capital, Area, Population, Continent, …
const COUNTRY_FIX: Record<string, string> = {
  'Democratic Republic of the Congo': 'DR Congo',
  'Republic of the Congo': 'Congo',
  'Ivory Coast': "Côte d'Ivoire",
  'Palestinian Territory': 'Palestine',
  'The Netherlands': 'Netherlands',
};
const countries = new Map<string, { name: string; continent: string }>();
for (const r of tsv('countryInfo.txt')) {
  const name = r[4]!.trim();
  if (Number(r[7]) < MIN_COUNTRY_POP || r[8] === 'AN') continue;
  countries.set(r[0]!, { name: COUNTRY_FIX[name] ?? name, continent: r[8]! });
}
/** GeoNames' name where the English one is what people search for. */
const NAME_FIX: Record<number, string> = {
  2886242: 'Cologne',
  99071: 'Mosul',
  3998655: 'León',
  100077: 'Abu Ghraib',
  285839: 'Al Ahmadi',
  3991164: 'Querétaro',
  6077243: 'Montreal',
  2657896: 'Zurich',
};
const admin1 = new Map<string, string>();
for (const r of tsv('admin1CodesASCII.txt')) admin1.set(r[0]!, r[1]!);

interface Row {
  id: number;
  name: string;
  ascii: string;
  lat: number;
  lon: number;
  cls: string;
  code: string;
  cc: string;
  a1: string;
  pop: number;
  tz: string;
}
// cities15000.txt columns: geonameid, name, asciiname, alternatenames, lat, lon, feature class,
// feature code, country code, cc2, admin1, admin2, admin3, admin4, population, elevation, dem, timezone, modified
const rows: Row[] = tsv('cities15000.txt').map((r) => ({
  id: Number(r[0]),
  name: NAME_FIX[Number(r[0])] ?? r[1]!,
  ascii: r[2]!,
  lat: Number(r[4]),
  lon: Number(r[5]),
  cls: r[6]!,
  code: r[7]!,
  cc: r[8]!,
  a1: r[10]!,
  pop: Number(r[14] || 0),
  tz: r[17]!,
}));

const byCountry = new Map<string, Row[]>();
for (const r of rows) {
  if (r.cls !== 'P' || r.cc === 'IN' || !countries.has(r.cc)) continue;
  let a = byCountry.get(r.cc);
  if (!a) byCountry.set(r.cc, (a = []));
  a.push(r);
}

/** Great-circle distance in km. */
function km(a: Row, b: Row): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/**
 * A place this close to a bigger chosen city sits in the same model grid
 * cells (CAMS is ~11–45 km), so it would only repeat that city's number:
 * Brooklyn and Queens beside New York City, say.
 */
const SAME_CELL_KM = 20;

const chosen: Row[] = [];
for (const list of byCountry.values()) {
  list.sort((a, b) => b.pop - a.pop);
  const pick = new Map<number, Row>();
  pick.set(list[0]!.id, list[0]!);
  for (const r of list) if (r.code === 'PPLC') pick.set(r.id, r);
  for (const r of list.filter((x) => x.pop >= MIN_POP)) {
    if (pick.size >= PER_COUNTRY) break;
    if ([...pick.values()].some((p) => km(p, r) < SAME_CELL_KM)) continue;
    pick.set(r.id, r);
  }
  // A capital or largest city can still sit beside a bigger pick; keep the bigger one.
  const kept = [...pick.values()].sort((a, b) => b.pop - a.pop);
  chosen.push(...kept.filter((r, i) => !kept.slice(0, i).some((p) => km(p, r) < SAME_CELL_KM)));
}

// Slugs: unique within a country; a clash takes the region's name.
const out = [];
const used = new Set<string>();
for (const r of chosen.sort((a, b) => b.pop - a.pop)) {
  const c = countries.get(r.cc)!;
  const region = admin1.get(`${r.cc}.${r.a1}`) ?? '';
  let slug = slugify(NAME_FIX[r.id] ?? (r.ascii || r.name));
  if (!slug) slug = String(r.id);
  if (used.has(`${r.cc}/${slug}`)) slug = `${slug}-${slugify(region) || r.id}`;
  used.add(`${r.cc}/${slug}`);
  out.push({
    id: r.id,
    slug,
    name: r.name,
    cc: r.cc,
    country: c.name,
    cslug: slugify(c.name),
    continent: c.continent,
    region,
    lat: Math.round(r.lat * 1e4) / 1e4,
    lon: Math.round(r.lon * 1e4) / 1e4,
    pop: r.pop,
    tz: r.tz,
    capital: r.code === 'PPLC',
  });
}

const target = new URL('../packages/data/src/world-cities.json', import.meta.url);
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`world-cities.json: ${out.length} cities in ${new Set(out.map((c) => c.cc)).size} countries`);
