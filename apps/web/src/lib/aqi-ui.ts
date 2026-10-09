import { naqiCategory, usCategory, US_CATEGORIES, type NaqiCategory } from '@saans/aqi';

/** Colour slot names shared by both scales (DESIGN.md §2.2). */
export type SlotName = NaqiCategory | 'none';

export function slotN(aqi: number | null | undefined): SlotName {
  return typeof aqi === 'number' ? naqiCategory(aqi) : 'none';
}

const US_TO_SLOT: Record<(typeof US_CATEGORIES)[number], NaqiCategory> = {
  good: 'good',
  moderate: 'satisfactory',
  usg: 'moderate',
  unhealthy: 'poor',
  veryunhealthy: 'verypoor',
  hazardous: 'severe',
};

/** The US category drawn in the same six colour slots, in order. */
export function slotU(aqi: number | null | undefined): SlotName {
  return typeof aqi === 'number' ? US_TO_SLOT[usCategory(aqi)] : 'none';
}

export const CATEGORY_LABEL: Record<NaqiCategory, { en: string; hi: string }> = {
  good: { en: 'Good', hi: 'अच्छा' },
  satisfactory: { en: 'Satisfactory', hi: 'संतोषजनक' },
  moderate: { en: 'Moderate', hi: 'मध्यम' },
  poor: { en: 'Poor', hi: 'खराब' },
  verypoor: { en: 'Very Poor', hi: 'बहुत खराब' },
  severe: { en: 'Severe', hi: 'गंभीर' },
};

export const US_LABEL: Record<(typeof US_CATEGORIES)[number], { en: string; hi: string }> = {
  good: { en: 'Good', hi: 'अच्छा' },
  moderate: { en: 'Moderate', hi: 'मध्यम' },
  usg: { en: 'Unhealthy for sensitive groups', hi: 'संवेदनशील लोगों के लिए अस्वस्थ' },
  unhealthy: { en: 'Unhealthy', hi: 'अस्वस्थ' },
  veryunhealthy: { en: 'Very unhealthy', hi: 'बहुत अस्वस्थ' },
  hazardous: { en: 'Hazardous', hi: 'ख़तरनाक' },
};

export function catLabel(aqi: number, lang: 'en' | 'hi'): string {
  return CATEGORY_LABEL[naqiCategory(aqi)][lang];
}

export function usLabel(aqi: number, lang: 'en' | 'hi'): string {
  return US_LABEL[usCategory(aqi)][lang];
}

export const NAQI_ROWS: { cat: NaqiCategory; range: string }[] = [
  { cat: 'good', range: '0–50' },
  { cat: 'satisfactory', range: '51–100' },
  { cat: 'moderate', range: '101–200' },
  { cat: 'poor', range: '201–300' },
  { cat: 'verypoor', range: '301–400' },
  { cat: 'severe', range: '401–500' },
];

export const US_ROWS: { cat: (typeof US_CATEGORIES)[number]; slot: NaqiCategory; range: string }[] = [
  { cat: 'good', slot: 'good', range: '0–50' },
  { cat: 'moderate', slot: 'satisfactory', range: '51–100' },
  { cat: 'usg', slot: 'moderate', range: '101–150' },
  { cat: 'unhealthy', slot: 'poor', range: '151–200' },
  { cat: 'veryunhealthy', slot: 'verypoor', range: '201–300' },
  { cat: 'hazardous', slot: 'severe', range: '301–500' },
];

/** Freshness states (PLAN.md §3.5): < 90 min fresh, < 6 h delayed, else stale. */
export type Freshness = 'fresh' | 'delayed' | 'stale';
export function freshness(iso: string | null | undefined, now = Date.now()): Freshness {
  if (!iso) return 'stale';
  const m = (now - Date.parse(iso)) / 60_000;
  if (m < 90) return 'fresh';
  if (m < 360) return 'delayed';
  return 'stale';
}

/** CPCB's bulletin names pollutants "PM2.5", "O3", "NO2"…; print them as the site does ("O₃"). */
export function cpcbPollutants(list: readonly string[]): string {
  return list.map((p) => p.replace(/^(O|NO|SO|NH)(\d)$/, (_, a: string, n: string) => a + String.fromCharCode(0x2080 + Number(n)))).join(', ');
}
