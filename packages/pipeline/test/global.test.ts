import { describe, expect, it } from 'vitest';
import { nowcast, usAqiHourly } from '@saans/aqi';
import { WORLD_CITIES, worldKey } from '@saans/data';
import { FUTURE_HOURS, PAST_HOURS, buildGlobal, fetchGlobalResponses, globalHour, globalNow, globalSeries, globalUrl, scoreBlock } from '../src/global.ts';

const H = 3600_000;
const T0 = Date.parse('2026-10-16T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** An Open-Meteo block of `len` hours from `start`, each pollutant given by a function of the hour index. */
function block(start: number, len: number, f: Partial<Record<string, (i: number) => number | null>>) {
  const hourly: Record<string, unknown> = { time: Array.from({ length: len }, (_, i) => iso(start + i * H)) };
  for (const v of ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide']) {
    hourly[v] = Array.from({ length: len }, (_, i) => (f[v] ? f[v]!(i) : 0));
  }
  return { hourly };
}

describe('scoreBlock', () => {
  it('steady air scores like the daily scale would', () => {
    const b = block(T0 - 48 * H, 120, { pm2_5: () => 20, pm10: () => 30, ozone: () => 40, carbon_monoxide: () => 300 });
    const s = scoreBlock(b, T0, 3);
    const want = usAqiHourly({ pm25: 20, pm10: 30, o3: 40, co: 0.3, no2: 0, so2: 0 })!;
    expect(s.a).toEqual([want.aqi, want.aqi, want.aqi]);
    expect(s.d).toBe('ppp');
    expect(s.c.pm25[0]).toBe(20);
    expect(s.c.co[0]).toBe(300);
  });

  it('uses NowCast for particles, so a rising hour pulls the index up at once', () => {
    // PM2.5 sits at 10, then jumps to 80 for the last two hours before T0.
    const b = block(T0 - 24 * H, 48, { pm2_5: (i) => (i >= 23 && i <= 24 ? 80 : 10) });
    const s = scoreBlock(b, T0, 1);
    const hours = Array.from({ length: 12 }, (_, k) => (k <= 1 ? 80 : 10));
    expect(s.a[0]).toBe(usAqiHourly({ pm25: nowcast(hours), o3: 0, co: 0, no2: 0, so2: 0, pm10: 0 })!.aqi);
  });

  it('scores NO2 on its own hour and names it when it dominates', () => {
    const b = block(T0 - 24 * H, 48, { pm2_5: () => 5, nitrogen_dioxide: (i) => (i === 24 ? 300 : 10) });
    const s = scoreBlock(b, T0, 2);
    expect(s.d[0]).toBe('n');
    expect(s.d[1]).toBe('p');
  });

  it('leaves hours outside the block null and needs no data to not throw', () => {
    const b = block(T0, 2, { pm2_5: () => 12 });
    const s = scoreBlock(b, T0 - 3 * H, 6);
    // T0 itself is still null: NowCast needs two of the three most recent hours.
    expect(s.a.slice(0, 4)).toEqual([null, null, null, null]);
    expect(s.a[4]).not.toBeNull();
    expect(s.d.slice(0, 4)).toBe('----');
    expect(scoreBlock(undefined, T0, 2).a).toEqual([null, null]);
    expect(scoreBlock({ hourly: { time: 'x' } }, T0, 1).a).toEqual([null]);
  });

  it('rejects negative and missing model values', () => {
    const b = block(T0 - 24 * H, 48, { pm2_5: (i) => (i === 24 ? -5 : null), pm10: () => null });
    expect(scoreBlock(b, T0, 1).a[0]).toBeNull();
  });
});

describe('buildGlobal and readers', () => {
  const sites = WORLD_CITIES.slice(0, 2);
  const now = T0 + 30 * 60_000;
  const bodies = sites.map(() => block(T0 - 48 * H, 120, { pm2_5: (i) => 10 + i / 10, pm10: () => 20 }));
  const g = buildGlobal([{ sites, body: bodies }], now);

  it('covers 24 h back and 48 h ahead of the current hour', () => {
    expect(g.n).toBe(PAST_HOURS + 1 + FUTURE_HOURS);
    expect(g.t0).toBe(new Date(T0 - PAST_HOURS * H).toISOString());
    expect(globalHour(g, now)).toBe(PAST_HOURS);
    expect(globalHour(g, T0 + 49 * H)).toBeNull();
  });

  it('keys cities by country/city and reads the current hour', () => {
    const key = worldKey(sites[0]!);
    const n = globalNow(g, key, now)!;
    expect(n.at).toBe(new Date(T0).toISOString());
    expect(n.aqi).toBe(g.cities[key]!.a[PAST_HOURS]);
    expect(n.dominant).toBe('pm25');
    expect(globalNow(g, 'nowhere/none', now)).toBeNull();
  });

  it('a single-site response (an object, not an array) still parses', () => {
    const one = buildGlobal([{ sites: [sites[0]!], body: bodies[0] }], now);
    expect(Object.keys(one.cities)).toEqual([worldKey(sites[0]!)]);
  });

  it('series run from the past into the forecast', () => {
    const s = globalSeries(g, worldKey(sites[0]!), -2, 5, now);
    expect(s).toHaveLength(5);
    expect(s[2]!.t).toBe(new Date(T0).toISOString());
  });

  it('builds a URL with every coordinate and pollutant', () => {
    const u = new URL(globalUrl(sites));
    expect(u.searchParams.get('latitude')!.split(',')).toHaveLength(2);
    expect(u.searchParams.get('hourly')).toContain('nitrogen_dioxide');
    expect(u.searchParams.get('forecast_days')).toBe('3');
  });
});

describe('WORLD_CITIES', () => {
  it('has unique keys, no Indian cities and sane coordinates', () => {
    const keys = WORLD_CITIES.map(worldKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(WORLD_CITIES.some((c) => c.cc === 'IN')).toBe(false);
    for (const c of WORLD_CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(c.slug).toMatch(/^[a-z0-9-]+$/);
      expect(c.cslug).toMatch(/^[a-z0-9-]+$/);
    }
  });
  it('stays inside the Open-Meteo budget (≈ 4 refreshes × cities ≤ 3,000 calls a day)', () => {
    expect(WORLD_CITIES.length * 4).toBeLessThanOrEqual(3000);
  });
});

describe('fetchGlobalResponses', () => {
  const sites = WORLD_CITIES.slice(0, 3);
  const ok = () => new Response(JSON.stringify(sites.map(() => ({ hourly: { time: [] } }))), { status: 200 });
  it('retries a dropped connection and a rate limit, then succeeds', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed', { cause: new Error('other side closed') });
      if (calls === 2) return new Response('slow down', { status: 429 });
      return ok();
    }) as typeof fetch;
    const out = await fetchGlobalResponses(sites, { fetchImpl: f, pauseMs: 0, retryMs: 0 });
    expect(calls).toBe(3);
    expect(out).toHaveLength(1);
  });
  it('gives up with the cause after four failures', async () => {
    const f = (async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') }); }) as typeof fetch;
    await expect(fetchGlobalResponses(sites, { fetchImpl: f, pauseMs: 0, retryMs: 0 })).rejects.toThrow(/ECONNRESET/);
  });
  it('does not retry a client error', async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response('bad', { status: 400 }); }) as typeof fetch;
    await expect(fetchGlobalResponses(sites, { fetchImpl: f, pauseMs: 0, retryMs: 0 })).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });
});
