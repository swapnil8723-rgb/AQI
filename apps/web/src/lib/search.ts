import { CITIES, SLUG_ALIASES, nameKey } from '@saans/data';

/** Best launch city for a free-text query (EN, HI, aliases, misspellings), or null. */
export function findCity(q: string): string | null {
  const k = nameKey(q);
  const deva = q.trim();
  if (!k && !deva) return null;
  const live = CITIES.filter((c) => c.live);
  const exact = live.find((c) => nameKey(c.en) === k || c.hi === deva || c.slug === k || c.aliases.some((a) => nameKey(a) === k || a === deva));
  if (exact) return exact.slug;
  if (SLUG_ALIASES[k]) return SLUG_ALIASES[k]!;
  if (k.length >= 3) {
    const prefix = live.find((c) => nameKey(c.en).startsWith(k) || c.aliases.some((a) => nameKey(a).startsWith(k)));
    if (prefix) return prefix.slug;
  }
  const hi = live.find((c) => deva && c.hi.startsWith(deva));
  return hi?.slug ?? null;
}
