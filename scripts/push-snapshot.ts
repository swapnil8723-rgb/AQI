/**
 * Push archived CPCB rows into an ingest Worker through POST /ingest — the
 * fallback path for when data.gov.in will not answer Cloudflare's IPs, and a
 * full end-to-end test of the Worker with real data.
 *
 *   node scripts/push-snapshot.ts <worker-url> <token> [YYYY-MM-DD] [HH]
 *   node scripts/push-snapshot.ts http://127.0.0.1:8787 local-test-token 2026-09-25 16
 *
 * Rows are rebuilt in data.gov.in's own record format, exactly as the API sends them.
 */
import { istAt, istParts } from '@saans/pipeline';
import { feedAsOf, loadParquetDays } from './lib/archive.ts';
import { addDays } from '@saans/pipeline';

const [url, token, day = '2026-09-25', hour = '16'] = process.argv.slice(2);
if (!url || !token) throw new Error('usage: push-snapshot.ts <worker-url> <token> [date] [hour]');

const snaps = await loadParquetDays([addDays(day, -1), day]);
const view = feedAsOf(snaps, istAt(day, Number(hour)));
if (!view) throw new Error('no snapshot');
const ID: Record<string, string> = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO2', so2: 'SO2', co: 'CO', o3: 'OZONE', nh3: 'NH3' };
const pad = (n: number) => String(n).padStart(2, '0');
const lastUpdate = (iso: string) => {
  const p = istParts(iso);
  return `${pad(p.d)}-${pad(p.m)}-${p.y} ${pad(p.h)}:${pad(p.mi)}:00`;
};
const na = (v: number | null) => (v === null ? 'NA' : String(v));
const records = view.rows.map((r) => ({
  country: 'India',
  state: r.state,
  city: r.city,
  station: r.station,
  last_update: r.updatedAt ? lastUpdate(r.updatedAt) : 'NA',
  latitude: na(r.lat),
  longitude: na(r.lon),
  pollutant_id: ID[r.pollutant],
  min_value: na(r.lo),
  max_value: na(r.hi),
  avg_value: na(r.avg),
}));
console.log(`pushing ${records.length} records as of ${view.at}`);
const res = await fetch(`${url.replace(/\/$/, '')}/ingest`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ records }),
});
console.log(res.status, await res.text());
