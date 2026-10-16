/**
 * Cities outside India that the global estimate covers (scripts/build-world-cities.ts,
 * from GeoNames, CC BY 4.0). India's cities are in cities.ts and city-coords.ts:
 * they have CPCB's bulletin behind them and keep India's own scale.
 */
import raw from './world-cities.json' with { type: 'json' };

export interface WorldCity {
  /** GeoNames id */
  id: number;
  /** Unique within its country. */
  slug: string;
  name: string;
  /** ISO 3166-1 alpha-2 */
  cc: string;
  country: string;
  /** Country slug, the first URL segment under /aqi/. */
  cslug: string;
  /** GeoNames continent code: AF, AS, EU, NA, OC, SA. */
  continent: string;
  /** First-level region (state, province), may be empty. */
  region: string;
  lat: number;
  lon: number;
  /** GeoNames population (city proper; definitions vary by country). */
  pop: number;
  /** IANA time zone, for local time on the page. */
  tz: string;
  capital: boolean;
}

export const WORLD_CITIES: readonly WorldCity[] = raw as WorldCity[];

/** The key a city has in the global bundle and its URL: "france/paris". */
export const worldKey = (c: Pick<WorldCity, 'cslug' | 'slug'>) => `${c.cslug}/${c.slug}`;

export const worldCityByKey: ReadonlyMap<string, WorldCity> = new Map(WORLD_CITIES.map((c) => [worldKey(c), c]));

export interface Country {
  cslug: string;
  name: string;
  cc: string;
  continent: string;
  /** Largest first. */
  cities: WorldCity[];
}

export const COUNTRIES: readonly Country[] = (() => {
  const by = new Map<string, Country>();
  for (const c of WORLD_CITIES) {
    let k = by.get(c.cslug);
    if (!k) by.set(c.cslug, (k = { cslug: c.cslug, name: c.country, cc: c.cc, continent: c.continent, cities: [] }));
    k.cities.push(c);
  }
  for (const k of by.values()) k.cities.sort((a, b) => b.pop - a.pop);
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

export const countryBySlug: ReadonlyMap<string, Country> = new Map(COUNTRIES.map((k) => [k.cslug, k]));

export const CONTINENTS: Readonly<Record<string, string>> = {
  AS: 'Asia',
  AF: 'Africa',
  EU: 'Europe',
  NA: 'North America',
  SA: 'South America',
  OC: 'Oceania',
};

/** Nearest covered cities, closest first (great-circle). */
export function nearestWorld(lat: number, lon: number, n = 6, skip?: WorldCity): WorldCity[] {
  const r = Math.PI / 180;
  const d = (c: WorldCity) => {
    const h = Math.sin(((c.lat - lat) * r) / 2) ** 2 + Math.cos(lat * r) * Math.cos(c.lat * r) * Math.sin(((c.lon - lon) * r) / 2) ** 2;
    return Math.asin(Math.sqrt(h));
  };
  return WORLD_CITIES.filter((c) => c !== skip)
    .map((c) => [d(c), c] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, n)
    .map(([, c]) => c);
}
