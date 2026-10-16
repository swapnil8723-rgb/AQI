import { describe, expect, it } from 'vitest';
import { NO2_UGM3_TO_PPB, SO2_UGM3_TO_PPB, nowcast, usAqiHourly, usNo2SubIndex, usSo2SubIndex } from '../src/index.ts';

const no2 = (ppb: number) => ppb / NO2_UGM3_TO_PPB;
const so2 = (ppb: number) => ppb / SO2_UGM3_TO_PPB;

describe('EPA NowCast', () => {
  it('a steady series is its own value', () => expect(nowcast(Array(12).fill(30))).toBeCloseTo(30, 9));
  it('weights by min/max, floored at 0.5', () => {
    // w = 10/20 = 0.5: (10 + 0.5·20) / (1 + 0.5)
    expect(nowcast([10, 20])).toBeCloseTo(13.333, 3);
    // w = 0.8 is above the floor: (40 + 0.8·50) / 1.8
    expect(nowcast([40, 50])).toBeCloseTo(44.444, 3);
    // a spike can never weigh less than the floor allows
    expect(nowcast([5, 500])).toBeCloseTo((5 + 0.5 * 500) / 1.5, 6);
  });
  it('keeps the hour position when an hour is missing', () => {
    expect(nowcast([null, 10, 20])).toBeCloseTo((0.5 * 10 + 0.25 * 20) / 0.75, 6);
  });
  it('needs two of the three most recent hours', () => {
    expect(nowcast([null, null, 10, 10, 10])).toBeNull();
    expect(nowcast([10, null, null, 10])).toBeNull();
    expect(nowcast([10, null, 10])).not.toBeNull();
  });
  it('ignores hours beyond the twelfth', () => {
    expect(nowcast([...Array(12).fill(20), 1000])).toBeCloseTo(20, 9);
  });
});

describe('US EPA NO2 and SO2, 1 hour', () => {
  const n: [number, number][] = [[0, 0], [53, 50], [54, 51], [100, 100], [101, 101], [360, 150], [361, 151], [649, 200], [650, 201], [1249, 300], [1250, 301], [2049, 500]];
  for (const [ppb, i] of n) it(`NO2 ${ppb} ppb → ${i}`, () => expect(usNo2SubIndex(no2(ppb) + 1e-9)).toBe(i));
  const s: [number, number][] = [[0, 0], [35, 50], [36, 51], [75, 100], [76, 101], [185, 150], [186, 151], [304, 200]];
  for (const [ppb, i] of s) it(`SO2 ${ppb} ppb → ${i}`, () => expect(usSo2SubIndex(so2(ppb) + 1e-9)).toBe(i));
  it('1-hour SO2 stops at 200: higher needs the 24-hour average', () => expect(usSo2SubIndex(so2(600))).toBe(200));
  it('1 ppb NO2 ≈ 1.882 µg/m³', () => expect(1 / NO2_UGM3_TO_PPB).toBeCloseTo(1.8818, 3));
  it('rejects negatives and gaps', () => {
    expect(usNo2SubIndex(-1)).toBeNull();
    expect(usSo2SubIndex(null)).toBeNull();
  });
});

describe('usAqiHourly', () => {
  it('takes the highest sub-index across all six', () => {
    const r = usAqiHourly({ pm25: 20, pm10: 40, o3: 60, co: 0.4, no2: no2(120) + 1e-9, so2: so2(10) });
    expect(r?.dominant).toBe('no2');
    expect(r?.aqi).toBe(usNo2SubIndex(no2(120) + 1e-9));
    expect(Object.keys(r!.sub).sort()).toEqual(['co', 'no2', 'o3', 'pm10', 'pm25', 'so2']);
  });
  it('needs a particulate reading, as the daily scale does', () => {
    expect(usAqiHourly({ no2: 200, o3: 100 })).toBeNull();
  });
});
