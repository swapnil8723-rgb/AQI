import type { Pollutant } from '@saans/aqi';

/** One data.gov.in record after normalisation. Values are CPCB sub-indices, not concentrations. */
export interface FeedRow {
  state: string;
  city: string;
  station: string;
  /** Station's last_update as ISO UTC, or null if unparseable. */
  updatedAt: string | null;
  lat: number | null;
  lon: number | null;
  pollutant: Pollutant;
  /** Lowest hourly sub-index in the past 24 h. */
  lo: number | null;
  /** Highest hourly sub-index in the past 24 h. */
  hi: number | null;
  /** The sub-index CPCB uses for the station AQI (24-h average; 8-h for CO and O3). */
  avg: number | null;
}

/**
 * Why a reading is flagged. Flagged readings stay in the archive; `excluded`
 * ones are left out of the AQI (PLAN.md §3.2 item 4: flag, don't delete).
 */
export type FlagKind = 'negative' | 'flat' | 'spike' | 'pm-ratio';

export interface Reading {
  /** Sub-index as published. */
  i: number;
  lo: number | null;
  hi: number | null;
  /** Concentration recovered from the sub-index (µg/m³; CO mg/m³). */
  c: number | null;
  flag?: FlagKind;
  excluded?: boolean;
}

export interface Station {
  id: string;
  /** CPCB's full name, e.g. "Anand Vihar, Delhi - DPCC". */
  name: string;
  /** "Anand Vihar" */
  place: string;
  /** "DPCC" */
  agency: string | null;
  city: string;
  state: string;
  /** Launch-city slug, if the station belongs to one. */
  citySlug: string | null;
  lat: number;
  lon: number;
  updatedAt: string | null;
  readings: Partial<Record<Pollutant, Reading>>;
  aqi: number | null;
  dominant: Pollutant[];
  us: number | null;
  valid: boolean;
  reason?: 'too-few-pollutants' | 'no-particulate' | 'stale';
  stale: boolean;
}

export interface BulletinRow {
  city: string;
  category: string;
  aqi: number;
  prominent: string[];
  used: number;
  /** Stations CPCB has in the city (bulletins before 2023 print only `used`). */
  total: number | null;
}

export interface Bulletin {
  /** YYYY-MM-DD (IST) the bulletin is for. */
  date: string;
  rows: BulletinRow[];
  /** Cities listed as absent due to insufficient data. */
  absent: string[];
  url: string;
}

// ─── The bundle: everything the website reads, written to KV once an hour ───

export interface BundleBulletin {
  date: string;
  aqi: number;
  prominent: string[];
  used: number;
  total: number | null;
  url: string;
  /** Our live estimate at 16:00 IST that day, for the reconciliation line. */
  ours: number | null;
}

export interface BundleStation {
  id: string;
  anchor: string;
  place: string;
  agency: string | null;
  lat: number;
  lon: number;
  aqi: number | null;
  us: number | null;
  dominant: Pollutant[];
  at: string | null;
  valid: boolean;
  reason?: Station['reason'];
  /** Sub-index per pollutant (excluded readings omitted). */
  r: Partial<Record<Pollutant, number>>;
  /** e.g. ["co:flat"] */
  flags: string[];
}

export interface CityNow {
  /** Mean of valid station AQIs — CPCB's own bulletin method. */
  aqi: number;
  min: number;
  max: number;
  /** Stations in the mean. */
  valid: number;
  /** Stations the feed carries for this city. */
  total: number;
  dominant: Pollutant[];
  /** Mean of valid stations' US EPA AQI (PM2.5, PM10, O3, CO only). */
  us: number | null;
  /** Newest station update among the valid stations (ISO UTC). */
  at: string;
  /** City mean sub-index and recovered concentration per pollutant. */
  pollutants: Partial<Record<Pollutant, { i: number; c: number; n: number }>>;
  /** Readings left out as abnormal this hour. */
  excluded: number;
  /**
   * Where the live estimate came from. Absent or 'cpcb' means the mean of
   * valid CPCB stations. 'cams' means the modelled city value (cams.ts), which
   * has no stations behind it — `valid` and `total` are then 0 and the page
   * must say the number is modelled.
   */
  source?: 'cpcb' | 'cams';
}

export interface HourPoint {
  /** Start of the IST hour, ISO UTC ("2026-10-10T10:30:00.000Z" = 16:00 IST). */
  t: string;
  aqi: number;
  /** US EPA AQI, for the comparison toggle. */
  u: number | null;
  n: number;
}

export interface DayPoint {
  /** YYYY-MM-DD (IST) */
  d: string;
  aqi: number;
}

export interface CityBundle {
  slug: string;
  now: CityNow | null;
  hours: HourPoint[];
  days: DayPoint[];
  bulletin: BundleBulletin | null;
  /** CPCB's bulletin value on the same calendar day last year. */
  lastYear?: DayPoint | null;
  stations: BundleStation[];
}

/** Every city in the feed (launch or not), for the national map and "near me". */
export interface MapCity {
  name: string;
  state: string;
  slug: string | null;
  lat: number;
  lon: number;
  aqi: number | null;
  n: number;
  /** US EPA AQI of the same value, for the map card when the scale is US. */
  us?: number | null;
  /** When the value is for (the model hour, or the newest station). */
  at?: string | null;
}

/** Compact all-India station list for the client-side nearest-station search. */
export interface LiteStation {
  /** place */
  p: string;
  /** feed city */
  c: string;
  /** launch-city slug */
  s: string | null;
  /** anchor on the city page ("station-anand-vihar"), launch cities only */
  h: string | null;
  la: number;
  lo: number;
  a: number | null;
  u: number | null;
  t: string | null;
}

/** How our 16:00 estimate compared with CPCB's bulletin, launch cities, all stored days. */
export interface Accuracy {
  n: number;
  within10: number;
  exact: number;
  from: string;
  to: string;
}

export interface Bundle {
  v: 1;
  generatedAt: string;
  /** Set only on local development fixtures (scripts/fixture.ts). */
  fixture?: { builtFrom: string; shiftedDays: number };
  accuracy?: Accuracy | null;
  /** Newest station update in the feed (ISO UTC). */
  feedAt: string | null;
  cities: Record<string, CityBundle>;
  map: MapCity[];
  stations: LiteStation[];
  source: string;
  /** What powered this hour's live estimate. 'cams' bundles carry no stations. */
  live?: 'cpcb' | 'cams';
}
