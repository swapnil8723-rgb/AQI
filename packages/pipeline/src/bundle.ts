import { CITIES, feedKey, stationAnchors, type City } from '@saans/data';
import { camsCityNow, type CamsCalibration, type CamsCity } from './cams.ts';
import { rollupCity } from './city.ts';
import { stationFlags } from './station.ts';
import type {
  Accuracy,
  Bundle,
  BundleBulletin,
  BundleStation,
  CityBundle,
  CityNow,
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

/**
 * Attribution while CPCB's hourly feed is down: the official daily figure is
 * still CPCB's bulletin, but the live estimate between bulletins is modelled.
 */
export const SOURCE_CAMS =
  'Central Pollution Control Board (daily AQI bulletin), Government Open Data License – India; live estimate from the Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo, CC BY 4.0';

export interface BundleInputs {
  stations: Station[];
  /**
   * Live estimate per launch city from a source other than stations (cams.ts).
   * When present it replaces the station rollup for that city.
   */
  cityNow?: Record<string, CityNow | null>;
  /** Cities for the national map when there are no stations to group. */
  cams?: CamsCity[];
  /** Per-city correction for the modelled estimate (cams.ts). */
  calibration?: CamsCalibration;
  /** Last 24 hourly city estimates per launch city, oldest first. */
  hours?: Record<string, HourPoint[]>;
  /** Last 30 daily means per launch city, oldest first. */
  days?: Record<string, DayPoint[]>;
  /** Most recent bulletin value per launch city. */
  bulletins?: Record<string, BundleBulletin>;
  /** Bulletin value on the same day last year, per launch city. */
  lastYear?: Record<string, DayPoint>;
  accuracy?: Accuracy | null;
  now?: Date;
  /** Overrides what the bundle reports as the live estimate's source. */
  live?: 'cpcb' | 'cams';
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
    now: inputs.cityNow ? (inputs.cityNow[city.slug] ?? null) : rollupCity(mine),
    hours: inputs.hours?.[city.slug] ?? [],
    days: inputs.days?.[city.slug] ?? [],
    bulletin: inputs.bulletins?.[city.slug] ?? null,
    lastYear: inputs.lastYear?.[city.slug] ?? null,
    stations: sorted.map((s) => toBundleStation(s, anchors.get(s.id)!)),
  };
}

export function buildBundle(inputs: BundleInputs): Bundle {
  const { stations } = inputs;
  const now = inputs.now ?? new Date();
  const cities: Record<string, CityBundle> = {};
  for (const c of CITIES) cities[c.slug] = buildCity(c, stations, inputs);

  // Everything after the map is the same whichever source filled it.
  const finish = (): Bundle => {
    const anchorOf = new Map<string, string>();
    for (const c of Object.values(cities)) for (const st of c.stations) anchorOf.set(st.id, st.anchor);
    const lite: LiteStation[] = stations.map((s) => ({
      p: s.place,
      c: s.city,
      s: s.citySlug,
      h: anchorOf.get(s.id) ?? null,
      la: round(s.lat, 4),
      lo: round(s.lon, 4),
      a: s.valid ? s.aqi : null,
      u: s.valid ? s.us : null,
      t: s.updatedAt,
    }));
    const live = inputs.live ?? (inputs.cams?.length ? 'cams' : 'cpcb');
    const feedAt = live === 'cams'
      ? (inputs.cams ?? []).reduce<string | null>((m, c) => (!m || c.at > m ? c.at : m), null)
      : stations.reduce<string | null>((m, s) => (s.updatedAt && (!m || s.updatedAt > m) ? s.updatedAt : m), null);
    return {
      v: 1,
      generatedAt: now.toISOString(),
      feedAt,
      accuracy: inputs.accuracy ?? null,
      cities,
      map,
      stations: lite,
      source: live === 'cams' ? SOURCE_CAMS : SOURCE,
      live,
    };
  };

  // National map: every city in the feed, launch or not. With no stations to
  // group (cams.ts), the modelled cities carry the map instead; `n` is 0
  // because no station stands behind the value.
  const map: MapCity[] = [];
  if (inputs.cams?.length) {
    for (const c of inputs.cams) {
      const launch = c.slug ? CITIES.find((x) => x.slug === c.slug) : undefined;
      const now_ = launch ? cities[launch.slug]!.now : camsCityNow(c, inputs.calibration);
      map.push({
        name: launch?.en ?? c.name,
        state: c.state,
        slug: launch?.slug ?? null,
        lat: launch?.lat ?? round(c.lat, 4),
        lon: launch?.lon ?? round(c.lon, 4),
        aqi: now_?.aqi ?? null,
        n: 0,
      });
    }
    map.sort((a, b) => a.name.localeCompare(b.name));
    return finish();
  }

  const groups = new Map<string, Station[]>();
  for (const s of stations) {
    const k = feedKey(s.city, s.state);
    let a = groups.get(k);
    if (!a) groups.set(k, (a = []));
    a.push(s);
  }
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
  return finish();
}
