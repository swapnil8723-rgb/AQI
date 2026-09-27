import { describe, expect, it } from 'vitest';
import { CO_MGM3_TO_PPM, O3_UGM3_TO_PPM, usAqi, usCategory, usSlot, usSubIndex } from '../src/index.ts';

describe('US EPA PM2.5 (2024 revision) — every breakpoint', () => {
  const cases: [number, number][] = [
    [0, 0], [9.0, 50], [9.1, 51], [35.4, 100], [35.5, 101], [55.4, 150], [55.5, 151],
    [125.4, 200], [125.5, 201], [225.4, 300], [225.5, 301], [325.4, 500],
  ];
  for (const [c, i] of cases) it(`${c} µg/m³ → ${i}`, () => expect(usSubIndex('pm25', c)).toBe(i));
  it('truncates to 0.1 before lookup (9.09 → 9.0 → 50)', () => expect(usSubIndex('pm25', 9.09)).toBe(50));
  it('12.0 µg/m³ → 56 (was 50 before 2024)', () => expect(usSubIndex('pm25', 12)).toBe(56));
  it('caps at 500 above the table', () => expect(usSubIndex('pm25', 600)).toBe(500));
});

describe('US EPA PM10 (2024 revision) — every breakpoint', () => {
  const cases: [number, number][] = [
    [0, 0], [54, 50], [55, 51], [154, 100], [155, 101], [254, 150], [255, 151],
    [354, 200], [355, 201], [424, 300], [425, 301], [604, 500],
  ];
  for (const [c, i] of cases) it(`${c} µg/m³ → ${i}`, () => expect(usSubIndex('pm10', c)).toBe(i));
  it('truncates to an integer (54.9 → 54 → 50)', () => expect(usSubIndex('pm10', 54.9)).toBe(50));
});

describe('US EPA O3 8 h and CO 8 h — unit conversion and breakpoints', () => {
  it('0.054 ppm O3 → 50', () => expect(usSubIndex('o3', 0.054 / O3_UGM3_TO_PPM)).toBe(50));
  it('0.070 ppm O3 → 100', () => expect(usSubIndex('o3', 0.07 / O3_UGM3_TO_PPM)).toBe(100));
  it('0.106 ppm O3 → 201', () => expect(usSubIndex('o3', 0.106 / O3_UGM3_TO_PPM)).toBe(201));
  it('O3 above 0.200 ppm 8 h is capped at 300 (EPA uses 1-h O3 there)', () =>
    expect(usSubIndex('o3', 1000)).toBe(300));
  it('4.4 ppm CO → 50', () => expect(usSubIndex('co', 4.4 / CO_MGM3_TO_PPM)).toBe(50));
  it('9.5 ppm CO → 101', () => expect(usSubIndex('co', 9.5 / CO_MGM3_TO_PPM)).toBe(101));
  it('1 ppb O3 ≈ 1.963 µg/m³', () => expect(1 / (O3_UGM3_TO_PPM * 1000)).toBeCloseTo(1.9632, 3));
});

describe('usAqi', () => {
  it('takes the max and names it', () => {
    expect(usAqi({ pm25: 150, pm10: 300, o3: 60, co: 1.2 })).toEqual({ aqi: 225, dominant: 'pm25' });
  });
  it('needs a particulate reading', () => {
    expect(usAqi({ o3: 100, co: 2 })).toBeNull();
  });
  it('categories and slots', () => {
    expect(usCategory(50)).toBe('good');
    expect(usCategory(101)).toBe('usg');
    expect(usCategory(301)).toBe('hazardous');
    expect(usSlot(151)).toBe(4);
  });
});
