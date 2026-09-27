import { istDate, istParts } from '@saans/pipeline';
import type { Lang } from '../i18n/index.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:00" in IST. Digits stay Latin in both languages (DESIGN.md §3). */
export function istTime(iso: string): string {
  const p = istParts(iso);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "16:00" → "4 PM" / "शाम 4 बजे" */
export function hourLabel(h: number, lang: Lang): string {
  if (lang === 'hi') {
    const part = h < 4 ? 'रात' : h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 20 ? 'शाम' : 'रात';
    return `${part} ${h % 12 || 12} बजे`;
  }
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_HI = ['जन॰', 'फ़र॰', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अग॰', 'सित॰', 'अक्टू॰', 'नव॰', 'दिस॰'];

/** "26 Sep" / "26 सित॰" for a YYYY-MM-DD date. */
export function shortDate(date: string, lang: Lang): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${(lang === 'hi' ? MONTHS_HI : MONTHS_EN)[m - 1]}`;
}

/** "26 Sep 2026" */
export function longDate(date: string, lang: Lang): string {
  return `${shortDate(date, lang)} ${date.slice(0, 4)}`;
}

/** Minutes between an ISO instant and now. */
export function ageMinutes(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/** "18 min ago" / "18 मिनट पहले"; the page script refreshes it (data-rel). */
export function relative(iso: string, lang: Lang, now = Date.now()): string {
  const m = ageMinutes(iso, now);
  if (lang === 'hi') {
    if (m < 1) return 'अभी';
    if (m < 60) return `${m} मिनट पहले`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} घंटे पहले` : `${Math.floor(h / 24)} दिन पहले`;
  }
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

export function todayIst(now = Date.now()): string {
  return istDate(now);
}

export function fmtNum(n: number, digits = 0): string {
  return n.toFixed(digits);
}
