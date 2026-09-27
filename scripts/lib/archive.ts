/**
 * Readers for historical snapshots, used by the gate and the fixture builder.
 *
 * Until our own archive has a week of data, the gate replays the public
 * india-geodata archive (github.com/yashveeeeeeer/india-geodata, release
 * "aq-live", CC BY 4.0), which stores the same data.gov.in rows as Parquet.
 * Once ours is running, point --csv at our R2 dumps instead (same columns).
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { extractText, getDocumentProxy } from 'unpdf';
import { pollutantFromId, type FeedRow, parseBulletinText, bulletinUrl, type Bulletin } from '@saans/pipeline';

export const CACHE = join(import.meta.dirname, '..', '..', '.cache');

export interface Snapshot {
  /** ISO UTC of the snapshot. */
  at: string;
  rows: FeedRow[];
}

async function download(url: string, file: string): Promise<Buffer> {
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(join(file, '..'), { recursive: true });
  const res = await fetch(url, { headers: { 'user-agent': 'saans-gate (validation script)' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

export async function loadParquetDay(date: string): Promise<Snapshot[]> {
  const url = `https://github.com/yashveeeeeeer/india-geodata/releases/download/aq-live/aq-${date}.parquet`;
  const buf = await download(url, join(CACHE, 'parquet', `aq-${date}.parquet`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const raw = (await parquetReadObjects({ file: ab, compressors })) as Record<string, unknown>[];
  const by = new Map<string, FeedRow[]>();
  for (const r of raw) {
    const pollutant = pollutantFromId(r.pollutant_id);
    if (!pollutant) continue;
    // collected_at is CPCB's last_update — an IST wall-clock time that the
    // archive parsed without a timezone, so Parquet labels it UTC. Shift it back
    // (16:00 "Z" in the file is 16:00 IST). Found 27 Sep 2026: before the fix the
    // best match to the 4 PM bulletin appeared to be the "21:30 IST" snapshot.
    const at = new Date(new Date(r.collected_at as string | number | Date).getTime() - 330 * 60_000).toISOString();
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    let a = by.get(at);
    if (!a) by.set(at, (a = []));
    a.push({
      state: String(r.state ?? '').trim(),
      city: String(r.city ?? '').trim(),
      station: String(r.station ?? '').replace(/\s+/g, ' ').trim(),
      // The archive keeps its collection hour, not CPCB's last_update.
      updatedAt: at,
      lat: num(r.latitude),
      lon: num(r.longitude),
      pollutant,
      lo: num(r.min_value),
      hi: num(r.max_value),
      avg: num(r.avg_value),
    });
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, rows]) => ({ at, rows }));
}

/**
 * What the live feed would have shown at instant `t`: for every station and
 * pollutant, its newest reading at or before t (within `maxAgeH`). The archive
 * groups rows by each station's own update hour, so a station last updated at
 * 15:00 is missing from the 16:00 group — but the feed at 16:20 still carries it.
 */
export function feedAsOf(snaps: Snapshot[], t: string, maxAgeH = 6): Snapshot | null {
  const limit = Date.parse(t);
  const floor = limit - maxAgeH * 3600_000;
  const latest = new Map<string, FeedRow>();
  let newest = '';
  for (const snap of snaps) {
    const at = Date.parse(snap.at);
    if (at > limit || at < floor) continue;
    for (const r of snap.rows) {
      const k = `${r.station}|${r.pollutant}`;
      const prev = latest.get(k);
      if (!prev || (prev.updatedAt ?? '') < (r.updatedAt ?? '')) latest.set(k, r);
    }
    if (snap.at > newest) newest = snap.at;
  }
  return latest.size ? { at: newest, rows: [...latest.values()] } : null;
}

/** Load several days (a view at an early hour needs the previous day's rows). */
export async function loadParquetDays(dates: string[]): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  for (const d of dates) out.push(...(await loadParquetDay(d).catch(() => [])));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function loadBulletin(date: string): Promise<Bulletin | null> {
  const url = bulletinUrl(date);
  let buf: Buffer;
  try {
    buf = await download(url, join(CACHE, 'bulletin', `AQI_Bulletin_${date.replaceAll('-', '')}.pdf`));
  } catch {
    return null;
  }
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return parseBulletinText(text, url);
}
