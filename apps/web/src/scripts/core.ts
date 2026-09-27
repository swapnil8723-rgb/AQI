/**
 * The one client script every page loads (progressive enhancement only —
 * every page works with JS off). Theme, NAQI/US toggle, live relative times,
 * the search palette, and remembering the visitor's city.
 */

type Entry = { s: string; en: string; hi: string; st: string; a: string[]; q: number | null; u: number | null };

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
  store('city', here.dataset.cityPage);
  if (here.dataset.slot) store('citySlot', here.dataset.slot);
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

// ── Search palette (DESIGN.md §4.14) ────────────────────────────────────
const dialog = document.getElementById('search-palette') as HTMLDialogElement | null;
if (dialog) {
  const input = dialog.querySelector<HTMLInputElement>('input[name=q]')!;
  const list = dialog.querySelector<HTMLUListElement>('[data-palette-results]')!;
  const base = dialog.dataset.base ?? '/aqi/';
  let index: Entry[] = [];
  try {
    index = JSON.parse(dialog.querySelector('[data-search-index]')?.textContent ?? '[]');
  } catch {
    index = [];
  }
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, '');
  const SLOT = (a: number | null) =>
    a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 200 ? 'moderate' : a <= 300 ? 'poor' : a <= 400 ? 'verypoor' : 'severe';
  const USLOT = (a: number | null) =>
    a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 150 ? 'moderate' : a <= 200 ? 'poor' : a <= 300 ? 'verypoor' : 'severe';

  function score(e: Entry, q: string): number {
    if (!q) return 1;
    const names = [e.en, e.hi, e.s, ...e.a].map(norm);
    let best = 0;
    for (const n of names) {
      if (n === q) best = Math.max(best, 100);
      else if (n.startsWith(q)) best = Math.max(best, 80);
      else if (n.includes(q)) best = Math.max(best, 50);
      else {
        // Loose subsequence match catches typos like "gurgon".
        let i = 0;
        for (const ch of n) if (ch === q[i]) i++;
        if (i === q.length && q.length >= 3) best = Math.max(best, 20);
      }
    }
    return best;
  }
  let active = 0;
  function render() {
    const q = norm(input.value);
    const hits = index
      .map((e) => ({ e, s: score(e, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (lang === 'hi' ? a.e.hi : a.e.en).localeCompare(lang === 'hi' ? b.e.hi : b.e.en))
      .slice(0, 12);
    active = Math.min(active, Math.max(0, hits.length - 1));
    list.innerHTML = '';
    hits.forEach(({ e }, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `opt-${e.s}`;
      li.setAttribute('aria-selected', String(i === active));
      const a = document.createElement('a');
      a.href = base + e.s;
      a.className = `flex items-center gap-3 px-3 py-2.5 rounded-[6px] ${i === active ? 'bg-[var(--color-bg-muted)]' : 'hover:bg-[var(--color-bg-muted)]'}`;
      const primary = lang === 'hi' ? e.hi : e.en;
      const secondary = lang === 'hi' ? e.en : e.hi;
      a.innerHTML = `<span class="flex-1 min-w-0"><span class="font-medium">${primary}</span> <span class="deva text-[var(--color-fg-subtle)] t-small">${secondary}</span><span class="block t-small text-[var(--color-fg-subtle)]">${e.st}</span></span>`;
      if (e.q !== null) {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-full ring-1px t-small font-mono tabular';
        chip.dataset.aqi = SLOT(e.q);
        chip.dataset.aqiUs = USLOT(e.u);
        chip.innerHTML = `<span class="sq"></span><span class="v-n">${e.q}</span><span class="v-us">${e.u ?? '–'}</span>`;
        a.append(chip);
      }
      li.append(a);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', hits[active] ? `opt-${hits[active]!.e.s}` : '');
  }
  function open() {
    if (dialog!.open) return;
    dialog!.showModal();
    input.value = '';
    active = 0;
    render();
    input.focus();
  }
  document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));
  document.querySelectorAll<HTMLInputElement>('[data-search-open-on-focus]').forEach((i) =>
    i.addEventListener('focus', (ev) => {
      (ev.target as HTMLInputElement).blur();
      open();
    }),
  );
  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (ev.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      ev.preventDefault();
      open();
    }
  });
  dialog.querySelector('[data-palette-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (ev) => {
    const n = list.children.length;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = (active + 1) % Math.max(1, n);
      render();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = (active - 1 + n) % Math.max(1, n);
      render();
    } else if (ev.key === 'Enter') {
      const a = list.children[active]?.querySelector('a');
      if (a) {
        ev.preventDefault();
        location.href = a.href;
      }
    }
  });
}

// A module, not a global script: keeps names like FILL private to this file.
export {};
