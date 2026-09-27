import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  applySpikeRule,
  buildBundle,
  buildStations,
  bulletinKey,
  hourUtc,
  istAt,
  istDate,
  istHour,
  parseBulletinText,
  parseFeedRecords,
  parseIst,
  rollupCity,
  type FeedRow,
} from '../src/index.ts';

describe('time', () => {
  it('parses CPCB last_update (IST) into UTC', () => {
    expect(parseIst('26-09-2026 16:00:00')).toBe('2026-09-26T10:30:00.000Z');
    expect(parseIst('2026-09-26 16:00:00')).toBe('2026-09-26T10:30:00.000Z');
    expect(parseIst('01-01-2027 03:00:00')).toBe('2026-12-31T21:30:00.000Z');
  });
  it('rejects nonsense', () => {
    expect(parseIst('31-02-2026 10:00:00')).toBeNull();
    expect(parseIst('NA')).toBeNull();
    expect(parseIst('')).toBeNull();
  });
  it('IST calendar helpers', () => {
    expect(istDate('2026-09-26T19:00:00Z')).toBe('2026-09-27');
    expect(istAt('2026-09-26', 16)).toBe('2026-09-26T10:30:00.000Z');
    expect(hourUtc('2026-09-26T10:47:12Z')).toBe('2026-09-26T10:00:00.000Z');
    expect(istHour('2026-09-26T10:47:12Z')).toBe('2026-09-26T10:30:00.000Z');
    expect(istHour('2026-09-26T10:29:59Z')).toBe('2026-09-26T09:30:00.000Z');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

/** Rows copied from the feed on 25 Sep 2026, 16:00 IST. */
const raw = (station: string, city: string, state: string, p: string, lo: string, avg: string, hi: string) => ({
  country: 'India', state, city, station, last_update: '25-09-2026 16:00:00',
  latitude: '28.6', longitude: '77.2', pollutant_id: p, min_value: lo, max_value: hi, avg_value: avg,
});

const RECORDS = [
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'PM2.5', '19', '59', '158'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'PM10', '34', '90', '128'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'CO', '59', '66', '75'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'SO2', '20', '31', '45'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'OZONE', '1', '3', '6'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'NH3', '2', '3', '3'),
  raw('Anand Vihar, Delhi - DPCC', 'Delhi', 'Delhi', 'NO2', 'NA', 'NA', 'NA'),
  // Stuck CO sensor and no particulate data: invalid, exactly as CPCB's bulletin ("1/2").
  raw('Chhatikara, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'CO', '147', '148', '148'),
  raw('Chhatikara, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'NH3', '3', '4', '6'),
  raw('Chhatikara, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'PM10', 'NA', 'NA', 'NA'),
  raw('Omex Eternity, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'PM10', '15', '33', '54'),
  raw('Omex Eternity, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'PM2.5', '13', '36', '58'),
  raw('Omex Eternity, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'NO2', '27', '27', '27'),
  raw('Omex Eternity, Vrindavan - UPPCB', 'Vrindavan', 'Uttar Pradesh', 'OZONE', '15', '16', '16'),
  { station: 'Bad row', pollutant_id: 'XYZ' },
  'not an object',
];

describe('parseFeedRecords', () => {
  const r = parseFeedRecords(RECORDS);
  it('keeps valid rows, counts rejects', () => {
    expect(r.rows).toHaveLength(14);
    expect(r.rejected).toBe(2);
    expect(r.reasons).toEqual({ 'unknown-pollutant': 1, 'not-an-object': 1 });
  });
  it('maps OZONE → o3, NA → null, IST → UTC', () => {
    const o3 = r.rows.find((x) => x.pollutant === 'o3')!;
    expect(o3.avg).toBe(3);
    expect(r.rows.find((x) => x.pollutant === 'no2')!.avg).toBeNull();
    expect(o3.updatedAt).toBe('2026-09-25T10:30:00.000Z');
  });
  it('accepts the old pollutant_avg field names', () => {
    const old = parseFeedRecords([{ station: 'X - Y', city: 'A', state: 'B', pollutant_id: 'PM10', pollutant_avg: '42', pollutant_min: '1', pollutant_max: '80' }]);
    expect(old.rows[0]).toMatchObject({ avg: 42, lo: 1, hi: 80 });
  });
});

describe('buildStations', () => {
  const stations = buildStations(parseFeedRecords(RECORDS).rows);
  const byName = (n: string) => stations.find((s) => s.place === n)!;

  it('station AQI is the max sub-index (Anand Vihar: PM10 90)', () => {
    const s = byName('Anand Vihar');
    expect(s.aqi).toBe(90);
    expect(s.dominant).toEqual(['pm10']);
    expect(s.valid).toBe(true);
    expect(s.agency).toBe('DPCC');
    expect(s.citySlug).toBe('delhi');
    expect(s.readings.pm10!.c).toBeCloseTo(90, 5);
    expect(s.us).not.toBeNull();
  });
  it('flags a flat Moderate trace and excludes it', () => {
    const s = byName('Chhatikara');
    expect(s.readings.co!.flag).toBe('flat');
    expect(s.readings.co!.excluded).toBe(true);
    expect(s.valid).toBe(false);
  });
  it('a low flat trace is not flagged (NO2 27 all day is plausible)', () => {
    expect(byName('Omex Eternity').readings.no2!.flag).toBeUndefined();
    expect(byName('Omex Eternity').aqi).toBe(36);
  });
  it('marks stations stale 3 h behind the feed', () => {
    const rows: FeedRow[] = parseFeedRecords([
      ...RECORDS.slice(0, 6),
      { ...raw('Old, Delhi - DPCC', 'Delhi', 'Delhi', 'PM10', '1', '50', '90'), last_update: '25-09-2026 12:00:00' },
      { ...raw('Old, Delhi - DPCC', 'Delhi', 'Delhi', 'PM2.5', '1', '50', '90'), last_update: '25-09-2026 12:00:00' },
      { ...raw('Old, Delhi - DPCC', 'Delhi', 'Delhi', 'NO2', '1', '50', '90'), last_update: '25-09-2026 12:00:00' },
    ]).rows;
    const old = buildStations(rows).find((s) => s.place === 'Old')!;
    expect(old.stale).toBe(true);
    expect(old.valid).toBe(false);
    expect(old.reason).toBe('stale');
  });
});

describe('spike rule', () => {
  const mk = (name: string, pm25: number) => [
    raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'PM2.5', '1', String(pm25), '499'),
    raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'PM10', '1', '100', '499'),
    raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'NO2', '1', '40', '99'),
    raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'CO', '1', '30', '99'),
  ];
  it('excludes a lone jump the rest of the city does not show', () => {
    const stations = buildStations(parseFeedRecords([...mk('A', 400), ...mk('B', 205), ...mk('C', 210)]).rows);
    const prev = new Map(stations.map((s) => [s.id, { pm25: 200 }]));
    const out = applySpikeRule(stations, prev, Date.parse('2026-09-25T10:30:00Z'));
    const a = out.find((s) => s.place === 'A')!;
    expect(a.readings.pm25!.flag).toBe('spike');
    expect(a.aqi).toBe(100);
  });
  it('keeps a city-wide jump (Diwali night)', () => {
    const stations = buildStations(parseFeedRecords([...mk('A', 400), ...mk('B', 390), ...mk('C', 410)]).rows);
    const prev = new Map(stations.map((s) => [s.id, { pm25: 200 }]));
    const out = applySpikeRule(stations, prev, null);
    expect(out.every((s) => s.readings.pm25!.flag !== 'spike')).toBe(true);
    expect(out.find((s) => s.place === 'B')!.aqi).toBe(390);
  });
});

describe('rollupCity', () => {
  it('means valid station AQIs, reports range and count', () => {
    const mk = (name: string, v: string) => [
      raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'PM10', '1', v, '499'),
      raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'NO2', '1', '20', '99'),
      raw(`${name}, Delhi - DPCC`, 'Delhi', 'Delhi', 'CO', '1', '30', '99'),
    ];
    const s = buildStations(parseFeedRecords([...mk('A', '142'), ...mk('B', '361'), ...mk('C', '300'), raw('D, Delhi - DPCC', 'Delhi', 'Delhi', 'CO', '1', '9', '20')]).rows);
    const now = rollupCity(s)!;
    expect(now.aqi).toBe(268); // (142 + 361 + 300) / 3 = 267.67
    expect([now.min, now.max, now.valid, now.total]).toEqual([142, 361, 3, 4]);
    expect(now.dominant).toEqual(['pm10']);
    expect(now.pollutants.pm10!.n).toBe(3);
  });
  it('null when nothing is valid', () => {
    expect(rollupCity([])).toBeNull();
  });
});

describe('parseBulletinText (real bulletin, 26 Sep 2026)', () => {
  const text = readFileSync(join(import.meta.dirname, 'fixtures', 'bulletin-2026-09-26.txt'), 'utf8');
  const b = parseBulletinText(text)!;
  const row = (c: string) => b.rows.find((r) => bulletinKey(r.city) === bulletinKey(c));

  it('reads the date and all 243 rows in order', () => {
    expect(b.date).toBe('2026-09-26');
    expect(b.rows).toHaveLength(243);
    expect(b.rows[0]).toEqual({ city: 'Agartala', category: 'Good', aqi: 30, prominent: ['CO'], used: 1, total: 2 });
    expect(b.rows.at(-1)!.city).toBe('Yamuna nagar');
  });
  it('Delhi 72 · PM10, CO · 43/46', () => {
    expect(row('Delhi')).toEqual({ city: 'Delhi', category: 'Satisfactory', aqi: 72, prominent: ['PM10', 'CO'], used: 43, total: 46 });
  });
  it('handles wrapped city names and multi-pollutant cells', () => {
    expect(row('Aurangabad')).toMatchObject({ city: 'Aurangabad (Maharashtra)', aqi: 62, prominent: ['PM2.5', 'PM10'], used: 3, total: 3 });
    expect(row('Greater Noida')).toMatchObject({ aqi: 47, used: 2 });
    expect(row('Navi Mumbai')).toMatchObject({ aqi: 48, used: 6, total: 8 });
    expect(row('Bhilai')!.prominent).toEqual(['SO2', 'O3']);
  });
  it('lists absent cities', () => {
    expect(b.absent).toHaveLength(79);
    expect(b.absent[0]).toBe('Ankleshwar');
    expect(b.absent).toContain('Aurangabad-Bihar');
    expect(b.absent.at(-1)).toBe('Virudhunagar');
  });
  it('reads the 2017–2022 layout (one station count, "#" and "_" in names)', () => {
    const old = parseBulletinText(
      'Air Quality Index on Nov 08, 2018 @ 4 PM (Average of past 24 hours) S.No City Air Quality Index Value Prominent Pollutant Based on Number of Monitoring Stations ' +
        '22 Ghaziabad Severe 422 PM2.5 1 23 Greater_Noida Severe 410 PM2.5 1 24 Gurugram# Very Poor 389 PM2.5 1 Good Minimal Impact Satisfactory Minor breathing discomfort ' +
        'Air Quality Index on Nov 08, 2018 @ 4 PM (Average of past 24 hours) S.No City Air Quality Index Value Prominent Pollutant Based on Number of Monitoring Stations 25 Delhi Very Poor 390 PM2.5 32',
    );
    // Serials 1–21 are missing from this excerpt, so only rows from a run starting at 1 are kept.
    expect(old!.rows).toEqual([]);
  });
  it('reads the 2015–16 layout (no serial numbers)', () => {
    const old = parseBulletinText(
      'Air Quality Index on Jan 01, 2016 @ 04:00 PM (Average of past 24 hours) City Air Quality Index Value Prominent Based on number of Pollutant monitoring stations ' +
        'Agra Severe 417 PM2.5 1 Bengaluru Satisfactory 95 PM2.5, PM10 5 Delhi Very Poor 391 PM2.5, PM10 7 Possible Health Impacts Good Minimal impact',
    )!;
    expect(old.date).toBe('2016-01-01');
    expect(old.rows.map((r) => [r.city, r.aqi, r.used, r.total])).toEqual([
      ['Agra', 417, 1, null],
      ['Bengaluru', 95, 5, null],
      ['Delhi', 391, 7, null],
    ]);
  });
  it('a serial run tolerates one unreadable row', () => {
    const t = 'Air Quality Index on Nov 08, 2018 @ 4 PM S.No City x ' +
      '1 Agra Very Poor 355 PM2.5 1 2 ??? garbage 3 Ajmer Poor 233 PM2.5 1 4 Greater_Noida Severe 410 PM2.5 1 5 Gurugram# Very Poor 389 PM2.5 1';
    expect(parseBulletinText(t)!.rows.map((r) => r.city)).toEqual(['Agra', 'Ajmer', 'Greater Noida', 'Gurugram']);
  });
  it('returns null for text that is not a bulletin', () => {
    expect(parseBulletinText('404 Not Found')).toBeNull();
  });
});

describe('buildBundle', () => {
  it('has every launch city, the national map and the lite station list', () => {
    const b = buildBundle({ stations: buildStations(parseFeedRecords(RECORDS).rows), now: new Date('2026-09-25T11:00:00Z') });
    expect(Object.keys(b.cities)).toHaveLength(25);
    expect(b.cities.delhi!.now!.aqi).toBe(90);
    expect(b.cities.delhi!.stations[0]!.anchor).toBe('station-anand-vihar');
    expect(b.cities.mumbai!.now).toBeNull();
    expect(b.map.find((m) => m.name === 'Vrindavan')).toMatchObject({ slug: null, aqi: 36, n: 2 });
    expect(b.stations).toHaveLength(3);
    expect(b.feedAt).toBe('2026-09-25T10:30:00.000Z');
  });
});
