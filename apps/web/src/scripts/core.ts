/**
 * The one client script every page loads (progressive enhancement only —
 * every page works with JS off). Theme, NAQI/US toggle, live relative times,
 * the search palette, and remembering the visitor's city.
 */

import './palette.ts';

const root = document.documentElement;
const lang = (root.dataset.lang ?? 'en') as 'en' | 'hi';

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the page still works */
  }
  return null;
}

// Controls that only work with JS (scale toggle, table sort) start hidden.
document.querySelectorAll<HTMLElement>('[data-js-only]').forEach((el) => {
  el.hidden = false;
});

// ── Theme ───────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) =>
  b.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store('theme', root.dataset.theme);
  }),
);

// ── NAQI / US scale (DESIGN.md §4.4) ────────────────────────────────────
function setScale(s: 'naqi' | 'us') {
  if (s === 'us') root.dataset.scale = 'us';
  else delete root.dataset.scale;
  store('scale', s === 'us' ? 'us' : null);
  document.querySelectorAll<HTMLButtonElement>('[data-scale-btn]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.scaleBtn === s)),
  );
}
document.querySelectorAll<HTMLButtonElement>('[data-scale-btn]').forEach((b) => {
  b.addEventListener('click', () => setScale(b.dataset.scaleBtn === 'us' ? 'us' : 'naqi'));
});
setScale(root.dataset.scale === 'us' ? 'us' : 'naqi');

// ── Relative times: the HTML is edge-cached for 10 min, so refresh them ──
function rel(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
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
function refreshTimes() {
  document.querySelectorAll<HTMLTimeElement>('time[data-rel]').forEach((el) => {
    const iso = el.getAttribute('datetime');
    if (!iso) return;
    el.textContent = rel(iso);
    const m = (Date.now() - Date.parse(iso)) / 60000;
    const dot = el.closest('[data-fresh]')?.querySelector<HTMLElement>('.fresh-dot');
    if (dot) dot.dataset.state = m < 90 ? 'fresh' : m < 360 ? 'delayed' : 'stale';
  });
}
refreshTimes();
setInterval(refreshTimes, 60_000);

// ── Remember the visitor's city (slug only, PLAN.md §5.3 C) ─────────────
const here = document.querySelector<HTMLElement>('[data-city-page]');
if (here?.dataset.cityPage) {
  const slug = here.dataset.cityPage;
  store('city', slug);
  if (here.dataset.slot) store('citySlot', here.dataset.slot);
  // Recent cities for the search palette (slugs only).
  let recent: string[] = [];
  try {
    recent = JSON.parse(store('recent') ?? '[]');
  } catch {
    recent = [];
  }
  store('recent', JSON.stringify([slug, ...recent.filter((x) => x !== slug)].slice(0, 5)));
}
// The living dot on other pages takes the remembered city's colour.
const FILL: Record<string, string> = {
  good: '#00B050', satisfactory: '#92D050', moderate: '#FFE600', poor: '#FF9900', verypoor: '#FF0000', severe: '#A50021',
};
const rememberedSlot = here ? null : store('citySlot');
if (rememberedSlot && FILL[rememberedSlot]) {
  document.querySelectorAll<HTMLElement>('[data-living-dot]').forEach((dot) => {
    dot.style.background = FILL[rememberedSlot]!;
  });
  const icon = document.querySelector<HTMLLinkElement>('link[data-living-icon]');
  if (icon) {
    icon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171717"/><circle cx="16" cy="16" r="8" fill="${FILL[rememberedSlot]}"/></svg>`)}`;
  }
}

// A module, not a global script: keeps names like FILL private to this file.
export {};
