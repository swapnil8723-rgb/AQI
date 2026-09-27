import { slugify } from './cities.ts';

/**
 * CPCB station names look like "Anand Vihar, Delhi - DPCC" or
 * "Sector - 62, Noida - IMD": place, city, then " - " and the operating agency.
 * Only the last " - " separates the agency ("Sector - 62" keeps its dash).
 */
export function parseStationName(raw: string, _city?: string): { place: string; agency: string | null } {
  // CPCB writes some names with underscores ("Pusa_IMD"); read them as spaces.
  const name = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = name.lastIndexOf(' - ');
  let place = cut > 0 ? name.slice(0, cut) : name;
  const agency = cut > 0 ? name.slice(cut + 3).trim() || null : null;
  const parts = place.split(',').map((p) => p.trim()).filter(Boolean);
  // The last comma part is the city (", Delhi", ", Noida"); earlier parts are
  // the place and its qualifiers ("IHBAS, Dilshad Garden").
  if (parts.length > 1) {
    parts.pop();
    place = parts.join(', ');
  }
  return { place: place || name, agency };
}

/** Stable id for the archive: the full CPCB name, slugified. */
export function stationId(raw: string): string {
  return slugify(raw.replace(/\s+/g, ' ').trim());
}

/**
 * Anchor ids on a city page ("#station-anand-vihar"). Falls back to the
 * agency suffix, then a counter, when two stations in a city share a place.
 */
export function stationAnchors(stations: { id: string; place: string; agency: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const counts = new Map<string, number>();
  for (const s of stations) {
    const k = slugify(s.place);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const s of stations) {
    let a = slugify(s.place) || s.id;
    if ((counts.get(a) ?? 0) > 1 && s.agency) a = `${a}-${slugify(s.agency)}`;
    let n = 2;
    const base = a;
    while (used.has(a)) a = `${base}-${n++}`;
    used.add(a);
    out.set(s.id, `station-${a}`);
  }
  return out;
}
