/**
 * CPCB daily AQI bulletin ("Air Quality Index on Sep 26, 2026 @ 4 PM").
 *
 * Published as a PDF, not an HTML table: cpcb.nic.in/aqi_report.php redirects
 * to https://cpcb.gov.in/upload/Downloads/AQI_Bulletin_YYYYMMDD.pdf (checked
 * 26 Sep 2026). The Worker extracts the text with unpdf and hands it here.
 *
 * Text layout per row (a city name or pollutant list may wrap onto the next line):
 *   "18 Aurangabad\n(Maharashtra)\nSatisfactory 62 PM2.5, PM10\n3/3"
 *   "70 Delhi Satisfactory 72 PM10, CO 43/46"
 */

import { CITIES } from '@saans/data';
import type { Bulletin, BulletinRow } from './types.ts';

export function bulletinUrl(date: string): string {
  return `https://cpcb.gov.in/upload/Downloads/AQI_Bulletin_${date.replaceAll('-', '')}.pdf`;
}

/** The page CPCB links to; it redirects to the day's PDF. */
export const BULLETIN_PAGE = 'https://cpcb.nic.in/aqi_report.php';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const CATEGORY = '(Good|Satisfactory|Moderate|Poor|Very\\s+Poor|Severe)';
const POLL = '(?:PM\\s?2\\.5|PM\\s?10|NO2|SO2|CO|O3|NH3|OZONE)';
const ROW = new RegExp(
  `(?:^|\\s)(?:(\\d{1,3})\\s+)?([A-Za-z][A-Za-z_ .()'&#*-]*?)\\s+${CATEGORY}\\s+(\\d{1,3})\\s+(${POLL}(?:\\s*,\\s*${POLL})*)\\s+(\\d{1,3})(?:\\s*\\/\\s*(\\d{1,3}))?(?=\\s|$)`,
  'g',
);

function normPollutant(p: string): string {
  const s = p.replace(/\s+/g, '').toUpperCase();
  return s === 'OZONE' ? 'O3' : s;
}

export function parseBulletinText(text: string, url = ''): Bulletin | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const dm = /Air Quality Index on ([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(flat);
  if (!dm) return null;
  const month = MONTHS[dm[1]!.toLowerCase()];
  if (!month) return null;
  const date = `${dm[3]}-${String(month).padStart(2, '0')}-${dm[2]!.padStart(2, '0')}`;

  // Drop the repeated page headers so they cannot glue onto a city name.
  const serials = /S\.\s?No/i.test(flat);
  const body = flat
    .replace(/Air Quality Index on [^)]*\)\s*/g, ' ')
    // Column headers of every layout, so they cannot glue onto a city name.
    .replace(/(?:S\.\s?No\s+)?City Air Quality Index Value Prominent.*?(?:Total Stations|monitoring stations|Monitoring Stations)/gi, ' ');

  // Older layouts repeat the health statements and notes after every page, so
  // the table is never cut; the row pattern cannot match that prose or the
  // absent list ("1) Ankleshwar, 2) Ariyalur").
  const table = body;
  const rows: BulletinRow[] = [];
  let expect = 1;
  for (const m of table.matchAll(ROW)) {
    if (serials) {
      // Serial numbers run 1, 2, 3 … — this guards against a stray number
      // matching. A small gap is allowed so one unreadable row costs only itself.
      const sno = Number(m[1]);
      if (!m[1] || sno < expect || sno > expect + 3) continue;
      expect = sno + 1;
    } else if (m[1]) continue;
    const used = Number(m[6]);
    rows.push({
      // 2018–21 mark some cities "#" (data from 3 PM) and write "Greater_Noida".
      city: m[2]!.replace(/[#*]+/g, '').replace(/_/g, ' ').trim(),
      category: m[3]!.replace(/\s+/g, ' '),
      aqi: Number(m[4]),
      prominent: m[5]!.split(',').map(normPollutant),
      used,
      total: m[7] ? Number(m[7]) : null,
    });
  }

  const absent: string[] = [];
  const am = /Cities absent in AQI Bulletin due to insufficient data:(.*?)(?:Notes:|$)/.exec(body);
  if (am) {
    for (const part of am[1]!.split(/\d+\)/)) {
      const name = part.replace(/,\s*$/, '').trim();
      if (name) absent.push(name.replace(/,$/, ''));
    }
  }
  return { date, rows, absent, url: url || bulletinUrl(date) };
}

/** Match a bulletin city name ("Greater noida", "Aurangabad (Maharashtra)") against ours. */
export function bulletinKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z]/g, '');
}

/** Primary key for the bulletin table: every letter of the printed name, qualifier kept. */
export function bulletinCityKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

const BY_BULLETIN = new Map(CITIES.map((c) => [bulletinKey(c.bulletin), c.slug]));

/** Launch-city slug for a bulletin row, if any. */
export function slugForBulletinCity(name: string): string | null {
  // "Aurangabad (Bihar)" must not match a plain "Aurangabad" launch city.
  if (/\(/.test(name)) return null;
  return BY_BULLETIN.get(bulletinKey(name)) ?? null;
}
