import type { NaqiCategory } from '@saans/aqi';

/**
 * CPCB's health statements, verbatim from the daily AQI bulletin
 * ("Health Statements for AQI Categories", checked 26 Sep 2026).
 * Hindi is our translation; the English text is CPCB's.
 */
export const CPCB_HEALTH: Readonly<Record<NaqiCategory, { en: string; hi: string }>> = {
  good: { en: 'Minimal impact', hi: 'न्यूनतम प्रभाव' },
  satisfactory: {
    en: 'Minor breathing discomfort to sensitive people',
    hi: 'संवेदनशील लोगों को सांस लेने में हल्की तकलीफ़',
  },
  moderate: {
    en: 'Breathing discomfort to the people with lungs, asthma and heart diseases',
    hi: 'फेफड़ों, अस्थमा और हृदय रोग वाले लोगों को सांस लेने में तकलीफ़',
  },
  poor: {
    en: 'Breathing discomfort to most people on prolonged exposure',
    hi: 'लंबे समय तक संपर्क में रहने पर अधिकांश लोगों को सांस लेने में तकलीफ़',
  },
  verypoor: {
    en: 'Respiratory illness on prolonged exposure',
    hi: 'लंबे समय तक संपर्क में रहने पर सांस की बीमारी',
  },
  severe: {
    en: 'Affects healthy people and seriously impacts those with existing diseases',
    hi: 'स्वस्थ लोगों पर असर और पहले से बीमार लोगों पर गंभीर प्रभाव',
  },
};

export type VerdictLevel = 'ok' | 'caution' | 'avoid';
export type VerdictRow = 'run' | 'kids' | 'windows' | 'mask';

export interface Verdict {
  level: VerdictLevel;
  en: string;
  hi: string;
}

/**
 * "What to do today" — a plain rendering of the CPCB statement for each
 * category (prolonged exposure → shorten; illness on prolonged exposure →
 * avoid). Rule-based, not AI, not medical advice. The level picks the colour:
 * ok = Good ink, caution = Poor ink, avoid = Very Poor ink (DESIGN.md §4.5).
 */
export const VERDICTS: Readonly<Record<NaqiCategory, Readonly<Record<VerdictRow, Verdict>>>> = {
  good: {
    run: { level: 'ok', en: 'OK', hi: 'ठीक है' },
    kids: { level: 'ok', en: 'OK', hi: 'ठीक है' },
    windows: { level: 'ok', en: 'Open', hi: 'खोलें' },
    mask: { level: 'ok', en: 'Not needed', hi: 'ज़रूरी नहीं' },
  },
  satisfactory: {
    run: { level: 'ok', en: 'OK', hi: 'ठीक है' },
    kids: { level: 'ok', en: 'OK', hi: 'ठीक है' },
    windows: { level: 'ok', en: 'Open', hi: 'खोलें' },
    mask: { level: 'ok', en: 'Not needed', hi: 'ज़रूरी नहीं' },
  },
  moderate: {
    run: { level: 'caution', en: 'Shorter if you have asthma', hi: 'अस्थमा हो तो कम करें' },
    kids: { level: 'ok', en: 'OK, less for asthmatic kids', hi: 'ठीक, अस्थमा वाले बच्चे कम' },
    windows: { level: 'ok', en: 'Open', hi: 'खोलें' },
    mask: { level: 'caution', en: 'If you have lung or heart disease', hi: 'फेफड़े या दिल की बीमारी हो तो' },
  },
  poor: {
    run: { level: 'caution', en: 'Shorten it', hi: 'कम करें' },
    kids: { level: 'caution', en: 'Limit it', hi: 'सीमित रखें' },
    windows: { level: 'caution', en: 'Open briefly', hi: 'थोड़ी देर खोलें' },
    mask: { level: 'caution', en: 'N95 if outside for long', hi: 'देर तक बाहर हों तो N95' },
  },
  verypoor: {
    run: { level: 'avoid', en: 'Avoid', hi: 'न करें' },
    kids: { level: 'avoid', en: 'Keep indoors', hi: 'घर के अंदर रखें' },
    windows: { level: 'avoid', en: 'Keep closed', hi: 'बंद रखें' },
    mask: { level: 'avoid', en: 'N95 outdoors', hi: 'बाहर N95 पहनें' },
  },
  severe: {
    run: { level: 'avoid', en: 'Avoid', hi: 'न करें' },
    kids: { level: 'avoid', en: 'Keep indoors', hi: 'घर के अंदर रखें' },
    windows: { level: 'avoid', en: 'Keep closed', hi: 'बंद रखें' },
    mask: { level: 'avoid', en: 'N95 outdoors', hi: 'बाहर N95 पहनें' },
  },
};
