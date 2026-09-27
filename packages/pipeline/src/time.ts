/** India Standard Time helpers. IST has no daylight saving: always UTC+05:30. */

export const IST_OFFSET_MIN = 330;

/**
 * Parse CPCB's "DD-MM-YYYY HH:MM:SS" (IST) into ISO UTC. Also accepts
 * "YYYY-MM-DD HH:MM:SS" (IST) and full ISO strings. Returns null if invalid.
 */
export function parseIst(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  let y: number, mo: number, d: number, h: number, mi: number, se: number;
  if (m) {
    [d, mo, y, h, mi, se] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t))) {
    [y, mo, d, h, mi, se] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  } else {
    const ms = Date.parse(t);
    return Number.isNaN(ms) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? null : new Date(ms).toISOString();
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, se) - IST_OFFSET_MIN * 60_000;
  const dt = new Date(ms);
  // Reject rollovers such as 31-02.
  const back = new Date(ms + IST_OFFSET_MIN * 60_000);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString();
}

/** Calendar parts of an instant in IST. */
export function istParts(iso: string | number | Date): { y: number; m: number; d: number; h: number; mi: number } {
  const ms = typeof iso === 'number' ? iso : new Date(iso).getTime();
  const t = new Date(ms + IST_OFFSET_MIN * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in IST. */
export function istDate(iso: string | number | Date): string {
  const p = istParts(iso);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Truncate an ISO instant to the UTC hour: "2026-10-10T10:00:00.000Z". */
export function hourUtc(iso: string | number | Date): string {
  const d = new Date(typeof iso === 'number' ? iso : new Date(iso).getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Start of the IST hour containing an instant, as ISO UTC. IST hours begin at
 * :30 UTC ("16:00 IST" = "10:30Z"), so this is the key for hourly rows.
 */
export function istHour(iso: string | number | Date): string {
  const ms = typeof iso === 'number' ? iso : new Date(iso).getTime();
  const shifted = ms + IST_OFFSET_MIN * 60_000;
  return new Date(shifted - (shifted % 3_600_000) - IST_OFFSET_MIN * 60_000).toISOString();
}

/** The UTC instant of HH:00 IST on a given IST date. */
export function istAt(date: string, hour: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0) - IST_OFFSET_MIN * 60_000).toISOString();
}

/** Shift an IST date string by n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
