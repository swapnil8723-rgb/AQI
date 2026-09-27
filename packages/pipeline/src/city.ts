import { naqiConcentration, type Pollutant } from '@saans/aqi';
import type { CityNow, Reading, Station } from './types.ts';

/**
 * The live estimate: the mean of valid station AQIs, which is the method CPCB
 * states for its own bulletin ("In case of a city with multiple monitoring
 * locations, average value is used"). Rounded to the nearest integer.
 *
 * Checked with scripts/gate.ts against the 20 and 23 Sep 2026 bulletins using
 * the feed as it stood at 16:00 IST: 97% of 478 city-days within ±10% of
 * CPCB, 85% identical, 49 of 50 launch city-days within ±10%.
 *
 * Dominant pollutant: the one with the highest mean sub-index across the valid
 * stations (ties listed). It is among CPCB's "Prominent Pollutant" list for
 * 96–97% of cities; CPCB often lists several, and we show theirs verbatim next
 * to the bulletin value.
 */
export function rollupCity(stations: Station[]): CityNow | null {
  const valid = stations.filter((s) => s.valid && s.aqi !== null);
  if (!valid.length) return null;
  const aqis = valid.map((s) => s.aqi!);
  const mean = aqis.reduce((a, b) => a + b, 0) / aqis.length;

  const acc = new Map<Pollutant, number[]>();
  let excluded = 0;
  for (const s of stations) {
    for (const [p, r] of Object.entries(s.readings) as [Pollutant, Reading][]) {
      if (r.excluded) excluded++;
    }
  }
  for (const s of valid) {
    for (const [p, r] of Object.entries(s.readings) as [Pollutant, Reading][]) {
      if (r.excluded) continue;
      let a = acc.get(p);
      if (!a) acc.set(p, (a = []));
      a.push(r.i);
    }
  }
  const pollutants: CityNow['pollutants'] = {};
  let best = -1;
  let dominant: Pollutant[] = [];
  for (const [p, xs] of acc) {
    const i = xs.reduce((a, b) => a + b, 0) / xs.length;
    pollutants[p] = { i: Math.round(i), c: round(naqiConcentration(p, i) ?? 0, p === 'co' ? 2 : 1), n: xs.length };
    const ri = Math.round(i);
    if (ri > best) {
      best = ri;
      dominant = [p];
    } else if (ri === best) dominant.push(p);
  }

  const us = valid.map((s) => s.us).filter((x): x is number => x !== null);
  const at = valid.reduce<string>((m, s) => (s.updatedAt && s.updatedAt > m ? s.updatedAt : m), '');
  return {
    aqi: Math.round(mean),
    min: Math.min(...aqis),
    max: Math.max(...aqis),
    valid: valid.length,
    total: stations.length,
    dominant,
    us: us.length ? Math.round(us.reduce((a, b) => a + b, 0) / us.length) : null,
    at,
    pollutants,
    excluded,
  };
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
