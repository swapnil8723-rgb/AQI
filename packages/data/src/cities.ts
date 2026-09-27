/**
 * Launch cities (PLAN.md §4.1). A city here gets an indexable page once
 * `live` is true; flip it only after the city has passed the §3.2 gate
 * (`npm run gate`) for 7 days running.
 *
 * Station → city mapping uses CPCB's own grouping: the data.gov.in feed's
 * `city` + `state` fields are the same grouping the 4 PM bulletin averages
 * over (checked 25 Sep 2026: Delhi 43 stations in the feed, bulletin "43/46";
 * Noida 4 and "4/4"; Gurugram 4 and "4/4"). So there is no hand-built station
 * list to drift out of date — new CPCB stations join their city automatically.
 *
 * lat/lon: mean of the city's CPCB station coordinates on 25 Sep 2026, used
 * for the map dot and for "nearest city". Hindi names are the forms used by
 * Hindi newspapers.
 */

export interface City {
  slug: string;
  en: string;
  hi: string;
  state: string;
  stateHi: string;
  /** How the data.gov.in feed spells the city and state. */
  feed: { city: string; state: string };
  /** How the CPCB 4 PM bulletin spells the city (case-insensitive match). */
  bulletin: string;
  lat: number;
  lon: number;
  /** Delhi-NCR: gets the GRAP section and the NCR inset on the India map. */
  ncr: boolean;
  wave: 1 | 2;
  /** Indexable and linked from the map/footer. Gate: PLAN.md §3.2. */
  live: boolean;
  /** Extra search terms (old names, common misspellings, Hindi variants). */
  aliases: string[];
}

export const CITIES: readonly City[] = [
  // Wave 1 — soft launch 10 Oct 2026
  { slug: 'delhi', en: 'Delhi', hi: 'दिल्ली', state: 'Delhi', stateHi: 'दिल्ली', feed: { city: 'Delhi', state: 'Delhi' }, bulletin: 'Delhi', lat: 28.6278, lon: 77.1745, ncr: true, wave: 1, live: true, aliases: ['new delhi', 'nai dilli', 'नई दिल्ली', 'dilli', 'ncr'] },
  { slug: 'noida', en: 'Noida', hi: 'नोएडा', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Noida', state: 'Uttar Pradesh' }, bulletin: 'Noida', lat: 28.5821, lon: 77.3462, ncr: true, wave: 1, live: true, aliases: ['noyda', 'gautam buddh nagar'] },
  { slug: 'gurugram', en: 'Gurugram', hi: 'गुरुग्राम', state: 'Haryana', stateHi: 'हरियाणा', feed: { city: 'Gurugram', state: 'Haryana' }, bulletin: 'Gurugram', lat: 28.4308, lon: 77.0971, ncr: true, wave: 1, live: true, aliases: ['gurgaon', 'गुड़गांव', 'gudgaon'] },
  { slug: 'ghaziabad', en: 'Ghaziabad', hi: 'गाज़ियाबाद', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Ghaziabad', state: 'Uttar Pradesh' }, bulletin: 'Ghaziabad', lat: 28.6899, lon: 77.3865, ncr: true, wave: 1, live: true, aliases: ['gaziabad', 'गाजियाबाद'] },
  { slug: 'faridabad', en: 'Faridabad', hi: 'फ़रीदाबाद', state: 'Haryana', stateHi: 'हरियाणा', feed: { city: 'Faridabad', state: 'Haryana' }, bulletin: 'Faridabad', lat: 28.4028, lon: 77.3127, ncr: true, wave: 1, live: true, aliases: ['faridabaad', 'फरीदाबाद'] },
  { slug: 'mumbai', en: 'Mumbai', hi: 'मुंबई', state: 'Maharashtra', stateHi: 'महाराष्ट्र', feed: { city: 'Mumbai', state: 'Maharashtra' }, bulletin: 'Mumbai', lat: 19.0782, lon: 72.8652, ncr: false, wave: 1, live: true, aliases: ['bombay', 'मुम्बई', 'bambai'] },
  { slug: 'pune', en: 'Pune', hi: 'पुणे', state: 'Maharashtra', stateHi: 'महाराष्ट्र', feed: { city: 'Pune', state: 'Maharashtra' }, bulletin: 'Pune', lat: 18.5093, lon: 73.8694, ncr: false, wave: 1, live: true, aliases: ['poona', 'pimpri chinchwad'] },
  { slug: 'kolkata', en: 'Kolkata', hi: 'कोलकाता', state: 'West Bengal', stateHi: 'पश्चिम बंगाल', feed: { city: 'Kolkata', state: 'West Bengal' }, bulletin: 'Kolkata', lat: 22.5511, lon: 88.3654, ncr: false, wave: 1, live: true, aliases: ['calcutta', 'कलकत्ता'] },
  { slug: 'bengaluru', en: 'Bengaluru', hi: 'बेंगलुरु', state: 'Karnataka', stateHi: 'कर्नाटक', feed: { city: 'Bengaluru', state: 'Karnataka' }, bulletin: 'Bengaluru', lat: 12.9569, lon: 77.5732, ncr: false, wave: 1, live: true, aliases: ['bangalore', 'बैंगलोर', 'bengalooru'] },
  { slug: 'lucknow', en: 'Lucknow', hi: 'लखनऊ', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Lucknow', state: 'Uttar Pradesh' }, bulletin: 'Lucknow', lat: 26.8546, lon: 80.9491, ncr: false, wave: 1, live: true, aliases: ['lakhnau'] },

  // Wave 2 — public launch 25 Oct 2026 (each only after passing the gate)
  { slug: 'greater-noida', en: 'Greater Noida', hi: 'ग्रेटर नोएडा', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Greater Noida', state: 'Uttar Pradesh' }, bulletin: 'Greater noida', lat: 28.5149, lon: 77.4678, ncr: true, wave: 2, live: true, aliases: ['gr noida', 'greater noida west', 'noida extension'] },
  { slug: 'chandigarh', en: 'Chandigarh', hi: 'चंडीगढ़', state: 'Chandigarh', stateHi: 'चंडीगढ़', feed: { city: 'Chandigarh', state: 'Chandigarh' }, bulletin: 'Chandigarh', lat: 30.7356, lon: 76.7591, ncr: false, wave: 2, live: true, aliases: ['chandigarh tricity'] },
  { slug: 'jaipur', en: 'Jaipur', hi: 'जयपुर', state: 'Rajasthan', stateHi: 'राजस्थान', feed: { city: 'Jaipur', state: 'Rajasthan' }, bulletin: 'Jaipur', lat: 26.9148, lon: 75.7812, ncr: false, wave: 2, live: true, aliases: ['pink city'] },
  { slug: 'kanpur', en: 'Kanpur', hi: 'कानपुर', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Kanpur', state: 'Uttar Pradesh' }, bulletin: 'Kanpur', lat: 26.4695, lon: 80.2999, ncr: false, wave: 2, live: true, aliases: ['cawnpore'] },
  { slug: 'agra', en: 'Agra', hi: 'आगरा', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Agra', state: 'Uttar Pradesh' }, bulletin: 'Agra', lat: 27.1996, lon: 77.9888, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'varanasi', en: 'Varanasi', hi: 'वाराणसी', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Varanasi', state: 'Uttar Pradesh' }, bulletin: 'Varanasi', lat: 25.3097, lon: 82.9743, ncr: false, wave: 2, live: true, aliases: ['banaras', 'benares', 'kashi', 'बनारस', 'काशी'] },
  { slug: 'patna', en: 'Patna', hi: 'पटना', state: 'Bihar', stateHi: 'बिहार', feed: { city: 'Patna', state: 'Bihar' }, bulletin: 'Patna', lat: 25.6009, lon: 85.125, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'ahmedabad', en: 'Ahmedabad', hi: 'अहमदाबाद', state: 'Gujarat', stateHi: 'गुजरात', feed: { city: 'Ahmedabad', state: 'Gujarat' }, bulletin: 'Ahmedabad', lat: 23.0333, lon: 72.5655, ncr: false, wave: 2, live: true, aliases: ['amdavad', 'अमदावाद'] },
  { slug: 'hyderabad', en: 'Hyderabad', hi: 'हैदराबाद', state: 'Telangana', stateHi: 'तेलंगाना', feed: { city: 'Hyderabad', state: 'Telangana' }, bulletin: 'Hyderabad', lat: 17.4697, lon: 78.3886, ncr: false, wave: 2, live: true, aliases: ['secunderabad', 'cyberabad'] },
  { slug: 'chennai', en: 'Chennai', hi: 'चेन्नई', state: 'Tamil Nadu', stateHi: 'तमिलनाडु', feed: { city: 'Chennai', state: 'Tamil Nadu' }, bulletin: 'Chennai', lat: 13.0839, lon: 80.2519, ncr: false, wave: 2, live: true, aliases: ['madras', 'मद्रास'] },
  { slug: 'bhopal', en: 'Bhopal', hi: 'भोपाल', state: 'Madhya Pradesh', stateHi: 'मध्य प्रदेश', feed: { city: 'Bhopal', state: 'Madhya Pradesh' }, bulletin: 'Bhopal', lat: 23.2363, lon: 77.4025, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'indore', en: 'Indore', hi: 'इंदौर', state: 'Madhya Pradesh', stateHi: 'मध्य प्रदेश', feed: { city: 'Indore', state: 'Madhya Pradesh' }, bulletin: 'Indore', lat: 22.6597, lon: 75.7907, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'nagpur', en: 'Nagpur', hi: 'नागपुर', state: 'Maharashtra', stateHi: 'महाराष्ट्र', feed: { city: 'Nagpur', state: 'Maharashtra' }, bulletin: 'Nagpur', lat: 21.1407, lon: 79.0644, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'ludhiana', en: 'Ludhiana', hi: 'लुधियाना', state: 'Punjab', stateHi: 'पंजाब', feed: { city: 'Ludhiana', state: 'Punjab' }, bulletin: 'Ludhiana', lat: 30.9028, lon: 75.8086, ncr: false, wave: 2, live: true, aliases: [] },
  { slug: 'meerut', en: 'Meerut', hi: 'मेरठ', state: 'Uttar Pradesh', stateHi: 'उत्तर प्रदेश', feed: { city: 'Meerut', state: 'Uttar Pradesh' }, bulletin: 'Meerut', lat: 28.9973, lon: 77.718, ncr: true, wave: 2, live: true, aliases: [] },
];

export const CITY_BY_SLUG: ReadonlyMap<string, City> = new Map(CITIES.map((c) => [c.slug, c]));

/** Old or alternative slugs that 301 to the canonical page (PLAN.md §4 URL notes). */
export const SLUG_ALIASES: Readonly<Record<string, string>> = {
  'new-delhi': 'delhi',
  gurgaon: 'gurugram',
  bangalore: 'bengaluru',
  bombay: 'mumbai',
  calcutta: 'kolkata',
  madras: 'chennai',
  poona: 'pune',
  banaras: 'varanasi',
  benares: 'varanasi',
  'gr-noida': 'greater-noida',
  'noida-extension': 'greater-noida',
  amdavad: 'ahmedabad',
};

/** Normalised key for matching feed and bulletin spellings: "Greater noida" = "Greater Noida". */
export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function feedKey(city: string, state: string): string {
  return `${nameKey(city)}|${nameKey(state)}`;
}

const BY_FEED = new Map(CITIES.map((c) => [feedKey(c.feed.city, c.feed.state), c]));

/** Launch city for a feed row's city/state, if any. */
export function cityForFeed(city: string, state: string): City | undefined {
  return BY_FEED.get(feedKey(city, state));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The n live cities nearest to a city (for the "nearby cities" strip). */
export function nearbyCities(slug: string, n = 6): City[] {
  const c = CITY_BY_SLUG.get(slug);
  if (!c) return [];
  return CITIES.filter((o) => o.slug !== slug && o.live)
    .map((o) => ({ o, d: haversineKm(c.lat, c.lon, o.lat, o.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.o);
}

/** Nearest live city to a point, with distance. */
export function nearestCity(lat: number, lon: number): { city: City; km: number } | null {
  let best: { city: City; km: number } | null = null;
  for (const c of CITIES) {
    if (!c.live) continue;
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { city: c, km };
  }
  return best;
}
