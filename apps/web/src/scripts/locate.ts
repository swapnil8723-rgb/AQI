/**
 * Location (PLAN.md §5.3 C, DESIGN.md §4.18). Precise coordinates never leave
 * the browser: the all-India station list is fetched and the nearest station
 * is found here, with haversine. Never prompts on page load — only on a tap,
 * or silently when permission was already granted.
 */

export interface LiteStation {
  p: string;
  c: string;
  s: string | null;
  la: number;
  lo: number;
  a: number | null;
  u: number | null;
  t: string | null;
}

export interface Nearest {
  station: LiteStation;
  km: number;
}

const FRESH_MS = 3 * 3600_000;
export const NEAR_KM = 25;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

let stationsPromise: Promise<{ stations: LiteStation[]; feedAt: string | null }> | null = null;
export function loadStations() {
  stationsPromise ??= fetch('/api/stations.json').then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  return stationsPromise;
}

/** Only stations with a valid, fresh AQI (< 3 h old) count (PLAN.md §5.3 C). */
export function nearest(list: LiteStation[], lat: number, lon: number): Nearest | null {
  let best: Nearest | null = null;
  const now = Date.now();
  for (const s of list) {
    if (s.a === null || !s.t || now - Date.parse(s.t) > FRESH_MS) continue;
    const km = haversineKm(lat, lon, s.la, s.lo);
    if (!best || km < best.km) best = { station: s, km };
  }
  return best;
}

export function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 });
  });
}

export async function permissionGranted(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return p?.state === 'granted';
  } catch {
    return false;
  }
}

export function slotOf(a: number | null, us = false): string {
  if (a === null) return 'none';
  if (us) return a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 150 ? 'moderate' : a <= 200 ? 'poor' : a <= 300 ? 'verypoor' : 'severe';
  return a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 200 ? 'moderate' : a <= 300 ? 'poor' : a <= 400 ? 'verypoor' : 'severe';
}
