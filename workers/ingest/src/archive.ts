import { POLLUTANTS } from '@saans/aqi';
import { istAt } from '@saans/pipeline';
import type { Env } from './env.ts';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Nightly dump of one IST day to R2 as gzipped CSV (PLAN.md §3): the station
 * archive (archive/YYYY/MM/DD.csv.gz) and that day's bulletin
 * (bulletin/YYYY/MM/DD.csv). Raw hourly API responses are already in raw/.
 */
export async function archiveDay(env: Env, date: string): Promise<{ stationRows: number; bulletinRows: number }> {
  const from = istAt(date, 0);
  const to = new Date(Date.parse(from) + 86400_000).toISOString();
  const cols = ['hour_utc', 'station_id', 'station', 'city', 'state', 'lat', 'lon', ...POLLUTANTS, 'lo', 'hi', 'flags', 'aqi', 'us', 'dominant', 'valid'];
  const { results } = await env.DB.prepare(
    `SELECT sh.hour AS hour_utc, sh.station_id, s.name AS station, s.city, s.state, s.lat, s.lon,
            ${POLLUTANTS.map((p) => `sh.${p}`).join(', ')}, sh.lo, sh.hi, sh.flags, sh.aqi, sh.us, sh.dominant, sh.valid
     FROM station_hour sh JOIN stations s ON s.id = sh.station_id
     WHERE sh.hour >= ? AND sh.hour < ? ORDER BY sh.hour, sh.station_id`,
  )
    .bind(from, to)
    .all<Record<string, unknown>>();
  const lines = [cols.join(',')];
  for (const r of results) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  const [y, m, d] = date.split('-');
  const body = new Response(new Blob([lines.join('\n') + '\n']).stream().pipeThrough(new CompressionStream('gzip')));
  await env.ARCHIVE.put(`archive/${y}/${m}/${d}.csv.gz`, await body.arrayBuffer(), {
    httpMetadata: { contentType: 'text/csv', contentEncoding: 'gzip' },
    customMetadata: { rows: String(results.length) },
  });

  const bcols = ['date', 'city', 'city_slug', 'aqi', 'category', 'prominent', 'used', 'total', 'ours'];
  const { results: brows } = await env.DB.prepare(`SELECT ${bcols.join(', ')} FROM bulletin WHERE date = ? ORDER BY city`)
    .bind(date)
    .all<Record<string, unknown>>();
  if (brows.length) {
    const b = [bcols.join(','), ...brows.map((r) => bcols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
    await env.ARCHIVE.put(`bulletin/${y}/${m}/${d}.csv`, b, { httpMetadata: { contentType: 'text/csv' } });
  }
  return { stationRows: results.length, bulletinRows: brows.length };
}

