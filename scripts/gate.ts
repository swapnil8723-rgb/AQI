/**
 * PLAN.md §3.2 gate, item 3: does our live estimate reproduce CPCB's 4 PM bulletin?
 *
 *   npm run gate                      # last 3 days available
 *   npm run gate -- 2026-09-23 2026-09-25
 *
 * For each date it takes the snapshot nearest 16:00 IST (CPCB computes the
 * bulletin from station AQIs at 4 PM), runs the production pipeline on it,
 * and compares every city with the bulletin: value (±10% target), station
 * count, and prominent pollutant. Exit code 1 if a launch city fails.
 */

import { CITIES, nameKey } from '@saans/data';
import { addDays, buildStations, bulletinKey, istAt, istDate, rollupCity, type Station } from '@saans/pipeline';
import { feedAsOf, loadBulletin, loadParquetDays } from './lib/archive.ts';

const TOLERANCE = 0.1;

const args = process.argv.slice(2);
let dates: string[];
if (args.length) dates = args;
else {
  const today = istDate(Date.now());
  dates = [1, 2, 3].map((n) => addDays(today, -n)).reverse();
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

interface Row {
  city: string;
  launch: boolean;
  ours: number;
  bulletin: number;
  delta: number;
  oursN: string;
  bullN: string;
  domOurs: string;
  domBull: string;
  domMatch: boolean;
  domMatchStation: boolean;
}

const all: Row[] = [];
let launchFails = 0;

for (const date of dates) {
  const [snaps, bulletin] = await Promise.all([loadParquetDays([addDays(date, -1), date]), loadBulletin(date)]);
  if (!bulletin) {
    console.log(`\n${date}: no bulletin`);
    continue;
  }
  const target = Date.parse(istAt(date, 16));
  const snap = feedAsOf(snaps, istAt(date, 16));
  if (!snap || target - Date.parse(snap.at) > 30 * 60_000) {
    console.log(`\n${date}: skipped — the archive has no reading at 16:00 IST (newest before it: ${snap?.at ?? 'none'})`);
    continue;
  }
  const stations = buildStations(snap.rows);
  const groups = new Map<string, Station[]>();
  for (const s of stations) {
    const k = nameKey(s.city);
    let a = groups.get(k);
    if (!a) groups.set(k, (a = []));
    a.push(s);
  }

  const rows: Row[] = [];
  for (const b of bulletin.rows) {
    const g = groups.get(bulletinKey(b.city));
    if (!g) continue;
    const now = rollupCity(g);
    if (!now) continue;
    // Station-majority dominant, the alternative hypothesis.
    const votes = new Map<string, number>();
    for (const s of g) if (s.valid) for (const p of s.dominant) votes.set(p, (votes.get(p) ?? 0) + 1);
    const top = Math.max(0, ...votes.values());
    const byStation = [...votes].filter(([, v]) => v === top).map(([p]) => p);
    const norm = (p: string) => p.replace('pm25', 'PM2.5').replace('pm10', 'PM10').toUpperCase().replace('O3', 'O3');
    const bull = b.prominent.map((p) => p.toUpperCase());
    const launch = CITIES.some((c) => bulletinKey(c.bulletin) === bulletinKey(b.city));
    rows.push({
      city: b.city,
      launch,
      ours: now.aqi,
      bulletin: b.aqi,
      delta: (now.aqi - b.aqi) / b.aqi,
      oursN: `${now.valid}/${now.total}`,
      bullN: `${b.used}/${b.total}`,
      domOurs: now.dominant.map(norm).join(','),
      domBull: bull.join(','),
      domMatch: now.dominant.map(norm).some((p) => bull.includes(p)),
      domMatchStation: byStation.map(norm).some((p) => bull.includes(p)),
    });
  }

  const within = rows.filter((r) => Math.abs(r.delta) <= TOLERANCE);
  const launchRows = rows.filter((r) => r.launch);
  const launchWithin = launchRows.filter((r) => Math.abs(r.delta) <= TOLERANCE);
  const countMatch = rows.filter((r) => r.oursN.split('/')[0] === r.bullN.split('/')[0]);
  const mae = rows.reduce((a, r) => a + Math.abs(r.ours - r.bulletin), 0) / (rows.length || 1);

  console.log(`\n══ ${date} · snapshot ${snap.at} (${Math.round((Date.parse(snap.at) - target) / 60000)} min from 16:00 IST) · bulletin ${bulletin.rows.length} cities`);
  console.log(`   all cities: ${within.length}/${rows.length} within ±10% (${pct(within.length, rows.length)}), mean |Δ| ${mae.toFixed(1)} AQI, station count equal in ${pct(countMatch.length, rows.length)}`);
  console.log(`   launch cities: ${launchWithin.length}/${launchRows.length} within ±10%`);
  console.log(`   prominent pollutant agrees: city-mean rule ${pct(rows.filter((r) => r.domMatch).length, rows.length)}, station-vote rule ${pct(rows.filter((r) => r.domMatchStation).length, rows.length)}`);
  console.log(`   ${pad('city', 16)}${lpad('ours', 6)}${lpad('CPCB', 6)}${lpad('Δ%', 7)}  ${pad('stations', 9)}${pad('CPCB', 7)} dominant (ours | CPCB)`);
  for (const r of launchRows.sort((a, b) => a.city.localeCompare(b.city))) {
    const ok = Math.abs(r.delta) <= TOLERANCE;
    if (!ok) launchFails++;
    console.log(
      `   ${ok ? ' ' : '✗'}${pad(r.city, 15)}${lpad(r.ours, 6)}${lpad(r.bulletin, 6)}${lpad((r.delta * 100).toFixed(1), 7)}  ${pad(r.oursN, 9)}${pad(r.bullN, 7)} ${r.domOurs} | ${r.domBull}`,
    );
  }
  const worst = rows.filter((r) => !r.launch && Math.abs(r.delta) > TOLERANCE).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (worst.length) {
    console.log(`   other cities outside ±10% (${worst.length}): ` + worst.slice(0, 12).map((r) => `${r.city} ${r.ours}/${r.bulletin}`).join(', ') + (worst.length > 12 ? ' …' : ''));
  }
  all.push(...rows);
}

function pct(a: number, b: number) {
  return b ? `${Math.round((100 * a) / b)}%` : '–';
}

if (all.length) {
  const w = all.filter((r) => Math.abs(r.delta) <= TOLERANCE).length;
  const l = all.filter((r) => r.launch);
  const lw = l.filter((r) => Math.abs(r.delta) <= TOLERANCE).length;
  const exact = all.filter((r) => r.ours === r.bulletin).length;
  console.log(`\nTOTAL city-days: ${w}/${all.length} within ±10% (${pct(w, all.length)}), exact match ${pct(exact, all.length)}; launch city-days ${lw}/${l.length} (${pct(lw, l.length)}).`);
}
process.exit(launchFails ? 1 : 0);
