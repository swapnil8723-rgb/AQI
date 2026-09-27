/**
 * Replay data: CPCB's official daily city AQI (4 PM bulletin) for a run of
 * days, for every city the bulletin lists — the "watch India's air" player on
 * the home map. Built from the bulletin archive, which goes back to 2015.
 */
import { nameKey } from '@saans/data';
import { bulletinKey, slugForBulletinCity } from './bulletin.ts';

export interface ReplayCity {
  /** Name as printed in the bulletin, qualifier removed. */
  n: string;
  la: number;
  lo: number;
  /** Launch-city slug, if any. */
  s: string | null;
  /** Official AQI per date (null: not in that day's bulletin). */
  v: (number | null)[];
}

export interface Replay {
  v: 1;
  /** YYYY-MM-DD, ascending. */
  dates: string[];
  /** Optional highlighted day, e.g. Diwali. */
  mark?: { date: string; label: string };
  cities: ReplayCity[];
}

export interface CityCoord {
  city: string;
  state: string;
  lat: number;
  lon: number;
}

/**
 * Coordinates for a bulletin name. The bulletin writes "Aurangabad
 * (Maharashtra)" where the feed has city "Aurangabad", state "Maharashtra";
 * an unqualified name is used only when it is unambiguous.
 */
export function coordLookup(coords: CityCoord[]): (bulletinCity: string) => { la: number; lo: number } | null {
  const exact = new Map<string, CityCoord>();
  const bare = new Map<string, CityCoord | null>();
  for (const c of coords) {
    exact.set(`${nameKey(c.city)}|${nameKey(c.state)}`, c);
    const k = nameKey(c.city);
    bare.set(k, bare.has(k) ? null : c);
  }
  return (name) => {
    const q = /\(([^)]+)\)/.exec(name)?.[1];
    const k = bulletinKey(name);
    const hit = (q && exact.get(`${k}|${nameKey(q)}`)) || bare.get(k) || null;
    return hit ? { la: Math.round(hit.lat * 1e4) / 1e4, lo: Math.round(hit.lon * 1e4) / 1e4 } : null;
  };
}

export function buildReplay(
  dates: string[],
  rowsByDate: Record<string, { city: string; aqi: number }[]>,
  coordOf: (bulletinCity: string) => { la: number; lo: number } | null,
  mark?: Replay['mark'],
): Replay {
  const byCity = new Map<string, ReplayCity>();
  dates.forEach((d, i) => {
    for (const r of rowsByDate[d] ?? []) {
      const key = r.city.toLowerCase().replace(/[^a-z()]/g, '');
      let c = byCity.get(key);
      if (!c) {
        const at = coordOf(r.city);
        if (!at) continue;
        c = { n: r.city.replace(/\s*\(.*?\)\s*/g, ' ').trim(), la: at.la, lo: at.lo, s: slugForBulletinCity(r.city), v: dates.map(() => null) };
        byCity.set(key, c);
      }
      c.v[i] = r.aqi;
    }
  });
  const out: Replay = { v: 1, dates, cities: [...byCity.values()].sort((a, b) => a.n.localeCompare(b.n)) };
  if (mark) out.mark = mark;
  return out;
}
