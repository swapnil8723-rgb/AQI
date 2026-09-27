import { CITIES, feedKey, stationAnchors, type City } from '@saans/data';
import { rollupCity } from './city.ts';
import { stationFlags } from './station.ts';
import type {
  Accuracy,
  Bundle,
  BundleBulletin,
  BundleStation,
  CityBundle,
  DayPoint,
  HourPoint,
  LiteStation,
  MapCity,
  Reading,
  Station,
} from './types.ts';
import type { Pollutant } from '@saans/aqi';

export const SOURCE =
  'Central Pollution Control Board (real-time data via data.gov.in and the daily AQI bulletin), Government Open Data License – India';

export interface BundleInputs {
  stations: Station[];
  /** Last 24 hourly city estimates per launch city, oldest first. */
  hours?: Record<string, HourPoint[]>;
  /** Last 30 daily means per launch city, oldest first. */
  days?: Record<string, DayPoint[]>;
  /** Most recent bulletin value per launch city. */
  bulletins?: Record<string, BundleBulletin>;
  accuracy?: Accuracy | null;
  now?: Date;
}

function toBundleStation(s: Station, anchor: string): BundleStation {
  const r: BundleStation['r'] = {};
  for (const [p, x] of Object.entries(s.readings) as [Pollutant, Reading][]) {
    if (!x.excluded) r[p] = x.i;
  }
  const out: BundleStation = {
    id: s.id,
    anchor,
    place: s.place,
    agency: s.agency,
    lat: round(s.lat, 5),
    lon: round(s.lon, 5),
    aqi: s.aqi,
    us: s.us,
    dominant: s.dominant,
    at: s.updatedAt,
    valid: s.valid,
    r,
    flags: stationFlags(s),
  };
  if (s.reason) out.reason = s.reason;
  return out;
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export function buildCity(city: City, stations: Station[], inputs: BundleInputs): CityBundle {
  const mine = stations.filter((s) => s.citySlug === city.slug);
  const anchors = stationAnchors(mine);
  // Valid first, worst first; then invalid by name.
  const sorted = [...mine].sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (a.aqi !== null && b.aqi !== null && a.aqi !== b.aqi) return b.aqi - a.aqi;
    return a.place.localeCompare(b.place);
  });
  return {
    slug: city.slug,
    now: rollupCity(mine),
    hours: inputs.hours?.[city.slug] ?? [],
    days: inputs.days?.[city.slug] ?? [],
    bulletin: inputs.bulletins?.[city.slug] ?? null,
    stations: sorted.map((s) => toBundleStation(s, anchors.get(s.id)!)),
  };
}

export function buildBundle(inputs: BundleInputs): Bundle {
  const { stations } = inputs;
  const now = inputs.now ?? new Date();
  const cities: Record<string, CityBundle> = {};
  for (const c of CITIES) cities[c.slug] = buildCity(c, stations, inputs);

  // National map: every city in the feed, launch or not.
  const groups = new Map<string, Station[]>();
  for (const s of stations) {
    const k = feedKey(s.city, s.state);
    let a = groups.get(k);
    if (!a) groups.set(k, (a = []));
    a.push(s);
  }
  const map: MapCity[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const launch = CITIES.find((c) => c.slug === first.citySlug);
    const now_ = launch ? cities[launch.slug]!.now : rollupCity(g);
    map.push({
      name: launch?.en ?? first.city,
      state: first.state,
      slug: launch?.slug ?? null,
      lat: launch?.lat ?? round(g.reduce((a, s) => a + s.lat, 0) / g.length, 4),
      lon: launch?.lon ?? round(g.reduce((a, s) => a + s.lon, 0) / g.length, 4),
      aqi: now_?.aqi ?? null,
      n: g.length,
    });
  }
  map.sort((a, b) => a.name.localeCompare(b.name));

  const lite: LiteStation[] = stations.map((s) => ({
    p: s.place,
    c: s.city,
    s: s.citySlug,
    la: round(s.lat, 4),
    lo: round(s.lon, 4),
    a: s.valid ? s.aqi : null,
    u: s.valid ? s.us : null,
    t: s.updatedAt,
  }));

  const feedAt = stations.reduce<string | null>((m, s) => (s.updatedAt && (!m || s.updatedAt > m) ? s.updatedAt : m), null);
  return { v: 1, generatedAt: now.toISOString(), feedAt, accuracy: inputs.accuracy ?? null, cities, map, stations: lite, source: SOURCE };
}
