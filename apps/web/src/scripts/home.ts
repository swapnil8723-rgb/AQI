/**
 * Home enhancements (PLAN.md §5.3 C): the "Your city" card and "Use my
 * location". Order: remembered city → already-granted GPS → IP city from
 * /api/here (labelled approximate) → the tap. Never prompts on load.
 */
import { haversineKm, loadStations, nearest, NEAR_KM, permissionGranted, position, slotOf } from './locate.ts';

interface C {
  s: string; en: string; hi: string; la: number; lo: number;
  a: number | null; u: number | null; c: string | null; cu: string | null; m: string | null; v: number; t: string | null;
}
interface T {
  live: string; details: string; approx: string; nearest: string; far: string; unavailable: string;
  finding: string; use: string; open: string; base: string; insufficient: string;
}

const raw = document.getElementById('home-cities')?.textContent;
const { cities, t } = (raw ? JSON.parse(raw) : { cities: [], t: {} }) as { cities: C[]; t: T };
const lang = document.documentElement.dataset.lang === 'hi' ? 'hi' : 'en';
const body = document.querySelector<HTMLElement>('[data-your-city-body]');
const note = document.querySelector<HTMLElement>('[data-locate-note]');
const nameOf = (c: C) => (lang === 'hi' ? c.hi : c.en);

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  return null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Fill the card for a city. `extra` is an optional line above it (approximate, nearest station…). */
function showCity(c: C, extra?: HTMLElement) {
  if (!body) return;
  body.replaceChildren();
  if (extra) body.append(extra);
  const row = el('div', 'flex items-end justify-between gap-4 mt-2');
  const left = el('div');
  left.append(el('p', 't-h3', nameOf(c)));
  const cat = el('p', 't-small mt-0.5');
  if (c.a !== null) {
    cat.innerHTML = `<span class="v-n"></span><span class="v-us"></span>`;
    (cat.children[0] as HTMLElement).textContent = c.c ?? '';
    (cat.children[1] as HTMLElement).textContent = c.cu ?? '';
  } else cat.textContent = t.insufficient;
  left.append(cat);
  if (c.m) left.append(el('p', 't-small font-mono text-[var(--color-fg-subtle)] mt-0.5', `${c.m} · ${c.v} ${lang === 'hi' ? 'स्टेशन' : c.v === 1 ? 'station' : 'stations'}`));
  const num = el('p', 'font-mono tabular text-[56px] leading-none font-semibold tracking-[-0.04em] px-3 py-2 rounded-[8px]');
  num.dataset.aqi = slotOf(c.a);
  num.dataset.aqiUs = slotOf(c.u, true);
  num.style.background = 'var(--aqi-fill)';
  num.style.color = 'var(--aqi-on)';
  num.innerHTML = `<span class="v-n"></span><span class="v-us"></span>`;
  (num.children[0] as HTMLElement).textContent = c.a === null ? '–' : String(c.a);
  (num.children[1] as HTMLElement).textContent = c.u === null ? '–' : String(c.u);
  row.append(left, num);
  body.append(row);
  const link = el('a', 'inline-block mt-4 t-small font-medium underline', `${t.details} →`);
  link.href = t.base + c.s;
  body.append(link);
  // Living dot takes this city's colour.
  if (c.a !== null) store('citySlot', slotOf(c.a));
}

function nearestCity(lat: number, lon: number): C | null {
  let best: { c: C; km: number } | null = null;
  for (const c of cities) {
    const km = haversineKm(lat, lon, c.la, c.lo);
    if (!best || km < best.km) best = { c, km };
  }
  return best?.c ?? null;
}

async function fromPosition(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lon } = pos.coords;
  const data = await loadStations();
  const n = nearest(data.stations, lat, lon);
  const city = (n?.station.s && cities.find((c) => c.s === n.station.s)) || nearestCity(lat, lon);
  const line = el('p', 't-small text-[var(--color-fg-muted)] mt-2');
  if (n && n.km <= NEAR_KM) {
    line.innerHTML = `${t.nearest} <strong class="font-medium text-[var(--color-fg)]"></strong> · <span class="font-mono"></span> · AQI <span class="font-mono tabular"><span class="v-n"></span><span class="v-us"></span></span>`;
    line.querySelector('strong')!.textContent = n.station.p;
    line.querySelectorAll('span.font-mono')[0]!.textContent = `${n.km.toFixed(1)} km`;
    const v = line.querySelectorAll('span.font-mono')[1]!;
    v.children[0]!.textContent = String(n.station.a);
    v.children[1]!.textContent = String(n.station.u ?? '–');
  } else if (n) {
    line.textContent = t.far.replace('%k', n.km.toFixed(1)).replace('%n', `${n.station.p} (${n.station.c})`);
  }
  if (city) {
    showCity(city, line);
    store('city', city.s);
  }
}

async function useLocation(btn?: HTMLButtonElement | null) {
  const label = btn?.querySelector('[data-locate-label]');
  if (btn) btn.disabled = true;
  if (label) label.textContent = t.finding;
  try {
    await fromPosition(await position());
    if (note) note.textContent = '';
  } catch {
    // Denied, timeout, unsupported: one calm line, focus the search (DESIGN.md §4.18: no red).
    if (note) note.textContent = t.unavailable;
    document.querySelector<HTMLInputElement>('#home-q')?.focus();
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = t.use;
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-locate-trigger]').forEach((b) =>
  b.addEventListener('click', () => {
    document.getElementById('near')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    useLocation(document.querySelector<HTMLButtonElement>('[data-locate-main]'));
  }),
);

(async () => {
  // 1. Returning visitor.
  const saved = store('city');
  const c = saved && cities.find((x) => x.s === saved);
  if (c) showCity(c);
  // 2. Already-granted GPS: silently refine to the nearest station.
  if (await permissionGranted()) {
    position().then(fromPosition).catch(() => undefined);
    return;
  }
  if (c) return;
  // 3. First visit: approximate city from the IP, no prompt.
  try {
    const r = await fetch('/api/here', { cache: 'no-store' });
    if (!r.ok) return;
    const h = (await r.json()) as { slug?: string };
    const city = h.slug ? cities.find((x) => x.s === h.slug) : null;
    if (city) showCity(city, el('p', 't-small text-[var(--color-fg-subtle)] mt-2', t.approx.replace('%s', nameOf(city))));
  } catch {
    /* keep the zero-JS card */
  }
})();
