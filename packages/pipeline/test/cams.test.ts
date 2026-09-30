import { describe, expect, it } from 'vitest';
import {
  camsCalibration,
  camsCityNow,
  camsFactor,
  camsUrl,
  MIN_CALIBRATION_DAYS,
  parseCams,
  type CamsSite,
} from '../src/index.ts';

const DELHI: CamsSite = { slug: 'delhi', name: 'Delhi', state: 'Delhi', lat: 28.6278, lon: 77.1745 };
const MUMBAI: CamsSite = { slug: 'mumbai', name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lon: 72.8777 };

/** Open-Meteo's shape: hourly arrays, "YYYY-MM-DDTHH:MM" in UTC. */
function block(hours: number, values: Partial<Record<string, number>>, endIso = '2026-09-30T08:00') {
  const end = Date.parse(`${endIso}:00Z`);
  const time: string[] = [];
  for (let i = hours - 1; i >= 0; i--) time.push(new Date(end - i * 3600_000).toISOString().slice(0, 16));
  const out: Record<string, unknown> = { time };
  for (const [k, v] of Object.entries(values)) out[k] = time.map(() => v);
  return { hourly: out };
}

const FULL = {
  pm2_5: 60,
  pm10: 100,
  nitrogen_dioxide: 40,
  sulphur_dioxide: 40,
  ozone: 50,
  carbon_monoxide: 1000, // µg/m³ = 1.0 mg/m³
};

const NOW = Date.parse('2026-09-30T08:00:00Z');

describe('camsUrl', () => {
  it('carries every site in one request, in order', () => {
    const u = new URL(camsUrl([DELHI, MUMBAI]));
    expect(u.searchParams.get('latitude')).toBe('28.6278,19.0760');
    expect(u.searchParams.get('longitude')).toBe('77.1745,72.8777');
    expect(u.searchParams.get('timezone')).toBe('UTC');
    expect(u.searchParams.get('hourly')).toContain('carbon_monoxide');
  });
});

describe('parseCams', () => {
  it('averages over each pollutant’s NAQI window and converts CO to mg/m³', () => {
    const [c] = parseCams([DELHI], [block(48, FULL)], NOW);
    expect(c!.at).toBe('2026-09-30T08:00:00.000Z');
    expect(c!.conc.pm25).toBeCloseTo(60, 6);
    expect(c!.conc.co).toBeCloseTo(1.0, 6); // 1000 µg/m³ → 1.0 mg/m³
    expect(c!.hours.pm25).toBe(24); // 24-h pollutant
    expect(c!.hours.o3).toBe(8); // 8-h pollutant
  });

  it('ignores forecast hours after now', () => {
    // Series ends 6 h in the future; the window must still end at `now`.
    const [c] = parseCams([DELHI], [block(48, FULL, '2026-09-30T14:00')], NOW);
    expect(c!.at).toBe('2026-09-30T08:00:00.000Z');
  });

  it('drops a pollutant whose window is mostly missing', () => {
    // Only 10 hours of history: the 24-h pollutants fail, the 8-h ones pass.
    const [c] = parseCams([DELHI], [block(10, FULL)], NOW);
    expect(c!.conc.pm25).toBeUndefined();
    expect(c!.conc.o3).toBeCloseTo(50, 6);
  });

  it('skips a malformed block without throwing, keeping site alignment', () => {
    const got = parseCams([DELHI, MUMBAI], [{}, block(48, FULL)], NOW);
    expect(got).toHaveLength(1);
    expect(got[0]!.slug).toBe('mumbai');
  });

  it('accepts a single-site response that is not an array', () => {
    expect(parseCams([DELHI], block(48, FULL), NOW)).toHaveLength(1);
  });
});

describe('camsCityNow', () => {
  it('applies CPCB’s sub-index and validity rule', () => {
    const [c] = parseCams([DELHI], [block(48, FULL)], NOW);
    const now = camsCityNow(c!)!;
    expect(now.source).toBe('cams');
    // PM2.5 60 and PM10 100 µg/m³ both sit on the top edge of the 51–100 band,
    // so they tie at 100 and CPCB's rule lists every tied pollutant.
    expect(now.aqi).toBe(100);
    expect(now.dominant).toEqual(['pm25', 'pm10']);
    // No stations stand behind a model grid cell.
    expect(now.valid).toBe(0);
    expect(now.total).toBe(0);
    expect(now.min).toBe(now.aqi);
    expect(now.max).toBe(now.aqi);
  });

  it('returns null when CPCB’s validity rule fails', () => {
    // Two pollutants, no particulate: not an AQI.
    const [c] = parseCams([DELHI], [block(48, { ozone: 50, nitrogen_dioxide: 40 })], NOW);
    expect(camsCityNow(c!)).toBeNull();
  });

  it('scales the headline by exactly the calibration factor', () => {
    const [c] = parseCams([DELHI], [block(48, FULL)], NOW);
    const raw = camsCityNow(c!)!;
    const half = camsCityNow(c!, { delhi: 0.5 })!;
    expect(half.aqi).toBe(Math.round(raw.aqi * 0.5));
  });

  it('falls back to the national factor for an uncalibrated city', () => {
    const [c] = parseCams([MUMBAI], [block(48, FULL)], NOW);
    const got = camsCityNow(c!, { delhi: 0.3, '*': 0.5 })!;
    expect(got.aqi).toBe(Math.round(camsCityNow(c!)!.aqi * 0.5));
  });
});

describe('camsCalibration', () => {
  const pairs = (slug: string, n: number, cpcb: number, ours: number) =>
    Array.from({ length: n }, () => ({ slug, cpcb, ours }));

  it('takes the median ratio per city', () => {
    const cal = camsCalibration([
      { slug: 'delhi', cpcb: 70, ours: 140 }, // 0.5
      { slug: 'delhi', cpcb: 60, ours: 150 }, // 0.4
      { slug: 'delhi', cpcb: 90, ours: 150 }, // 0.6
    ]);
    expect(cal['delhi']).toBeCloseTo(0.5, 3);
  });

  it('ignores a city with too few days, but still gives it the fallback', () => {
    const cal = camsCalibration([...pairs('delhi', MIN_CALIBRATION_DAYS, 70, 140), { slug: 'mumbai', cpcb: 50, ours: 200 }]);
    expect(cal['delhi']).toBeCloseTo(0.5, 3);
    expect(cal['mumbai']).toBe(cal['*']); // not its own 0.25
  });

  it('clamps an implausible correction', () => {
    const cal = camsCalibration(pairs('delhi', MIN_CALIBRATION_DAYS, 1, 1000));
    expect(cal['delhi']).toBeGreaterThanOrEqual(0.2);
  });

  it('ignores zero and negative readings', () => {
    const cal = camsCalibration([...pairs('delhi', MIN_CALIBRATION_DAYS, 70, 140), { slug: 'delhi', cpcb: 0, ours: 100 }]);
    expect(cal['delhi']).toBeCloseTo(0.5, 3);
  });

  it('returns nothing to apply when there is no usable history', () => {
    expect(camsCalibration([])).toEqual({});
    expect(camsFactor(camsCalibration([]), 'delhi')).toBe(1);
  });
});
