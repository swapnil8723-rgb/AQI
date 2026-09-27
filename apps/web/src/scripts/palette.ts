/**
 * The search palette (DESIGN.md §4.14). Three groups: launch cities (embedded,
 * instant), stations in those cities and every other CPCB city (fetched from
 * /api/search.json on first open). Empty state: use my location, recent,
 * popular. Hindi and English names, aliases ("Gurgaon", "बनारस") and station
 * names all match.
 */

type City = { s: string; en: string; hi: string; st: string; a: string[]; q: number | null; u: number | null };
type Station = { p: string; c: string; h: string; q: number | null; u: number | null };
type Other = { n: string; st: string; la: number; lo: number; q: number | null; near: string | null };
type Text = {
  cities: string; stations: string; others: string; popular: string; recent: string; locate: string; locateSub: string;
  none: string; near: string; map: string; home: string; base: string;
};
type Item = { href: string; title: string; alt?: string; sub: string; q: number | null; u: number | null; icon?: 'pin' | 'map' | 'loc' };

const SLOT = (a: number | null) =>
  a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 200 ? 'moderate' : a <= 300 ? 'poor' : a <= 400 ? 'verypoor' : 'severe';
const USLOT = (a: number | null) =>
  a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 150 ? 'moderate' : a <= 200 ? 'poor' : a <= 300 ? 'verypoor' : 'severe';
const POPULAR = ['delhi', 'mumbai', 'bengaluru', 'kolkata', 'chennai', 'hyderabad', 'pune', 'lucknow'];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 100 exact · 85 prefix · 70 word prefix ("vihar" → "Anand Vihar") ·
 * 45 contains (3+ letters) · 20 loose typo match (4+ letters, same first letter).
 */
export function score(q: string, names: string[]): number {
  if (!q) return 0;
  let best = 0;
  for (const raw of names) {
    const n = norm(raw);
    const flat = n.replace(/ /g, '');
    const qf = q.replace(/ /g, '');
    if (n === q || flat === qf) return 100;
    if (n.startsWith(q) || flat.startsWith(qf)) best = Math.max(best, 85);
    else if (n.split(' ').some((w) => w.startsWith(q))) best = Math.max(best, 70);
    else if (q.length >= 3 && flat.includes(qf)) best = Math.max(best, 45);
    else if (qf.length >= 4 && flat[0] === qf[0]) {
      let i = 0;
      for (const ch of flat) if (ch === qf[i]) i++;
      if (i === qf.length) best = Math.max(best, 20);
    }
  }
  return best;
}

const dialog = document.getElementById('search-palette') as HTMLDialogElement | null;
if (dialog) {
  const lang = dialog.dataset.lang === 'hi' ? 'hi' : 'en';
  const input = dialog.querySelector<HTMLInputElement>('input[name=q]')!;
  const box = dialog.querySelector<HTMLElement>('[data-palette-results]')!;
  const read = <T,>(sel: string, fallback: T): T => {
    try {
      return JSON.parse(dialog.querySelector(sel)?.textContent ?? '') as T;
    } catch {
      return fallback;
    }
  };
  const cities = read<City[]>('[data-search-index]', []);
  const T = read<Text>('[data-search-text]', {} as Text);
  const cityBySlug = new Map(cities.map((c) => [c.s, c]));
  let extra: { stations: Station[]; others: Other[] } | null = null;
  let loading: Promise<void> | null = null;
  let items: Item[] = [];
  let active = 0;

  const load = () =>
    (loading ??= fetch('/api/search.json')
      .then((r) => r.json())
      .then((j) => {
        extra = j;
        if (dialog.open) render();
      })
      .catch(() => undefined));

  const cityItem = (c: City): Item => ({
    href: T.base + c.s, title: lang === 'hi' ? c.hi : c.en, alt: lang === 'hi' ? c.en : c.hi, sub: c.st, q: c.q, u: c.u,
  });

  function recent(): string[] {
    try {
      return (JSON.parse(localStorage.getItem('recent') ?? '[]') as string[]).filter((s) => cityBySlug.has(s));
    } catch {
      return [];
    }
  }

  function row(it: Item, i: number): string {
    const chip =
      it.q === null
        ? ''
        : `<span class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full ring-1px text-[13px] font-mono tabular shrink-0" data-aqi="${SLOT(it.q)}" data-aqi-us="${USLOT(it.u)}"><span class="sq"></span><span class="v-n">${it.q}</span><span class="v-us">${it.u ?? '–'}</span></span>`;
    const icon =
      it.icon === 'loc'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
        : it.icon === 'pin'
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
          : it.icon === 'map'
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/></svg>';
    return (
      `<a role="option" id="pal-${i}" aria-selected="${i === active}" href="${esc(it.href)}" class="pal-row flex items-center gap-3 px-3 min-h-14 rounded-[8px]" data-i="${i}">` +
      `<span class="pal-ico grid place-items-center size-9 rounded-[8px] shrink-0 text-[var(--color-fg-muted)]">${icon}</span>` +
      `<span class="flex-1 min-w-0"><span class="block truncate"><span class="font-medium">${esc(it.title)}</span>${it.alt ? ` <span class="text-[var(--color-fg-subtle)]">${esc(it.alt)}</span>` : ''}</span>` +
      `<span class="block truncate t-small text-[var(--color-fg-subtle)]">${esc(it.sub)}</span></span>${chip}</a>`
    );
  }
  const head = (t: string) => `<p class="t-label text-[var(--color-fg-subtle)] px-3 pt-3 pb-1.5">${esc(t)}</p>`;

  function render() {
    const q = norm(input.value);
    items = [];
    let html = '';
    if (!q) {
      items.push({ href: `${T.home}#near`, title: T.locate, sub: T.locateSub, q: null, u: null, icon: 'loc' });
      html += row(items[0]!, 0);
      const rec = recent();
      if (rec.length) {
        html += head(T.recent);
        for (const s of rec) {
          items.push(cityItem(cityBySlug.get(s)!));
          html += row(items.at(-1)!, items.length - 1);
        }
      }
      html += head(T.popular);
      for (const s of POPULAR.filter((x) => !rec.includes(x) && cityBySlug.has(x))) {
        items.push(cityItem(cityBySlug.get(s)!));
        html += row(items.at(-1)!, items.length - 1);
      }
    } else {
      const c = cities
        .map((x) => ({ x, s: score(q, [x.en, x.hi, x.s, ...x.a]) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 6);
      if (c.length) {
        html += head(T.cities);
        for (const { x } of c) {
          items.push(cityItem(x));
          html += row(items.at(-1)!, items.length - 1);
        }
      }
      if (extra) {
        const st = extra.stations
          .map((x) => ({ x, s: score(q, [x.p]) }))
          .filter((x) => x.s >= 45)
          .sort((a, b) => b.s - a.s)
          .slice(0, 6);
        if (st.length) {
          html += head(T.stations);
          for (const { x } of st) {
            const city = cityBySlug.get(x.c);
            items.push({ href: `${T.base}${x.c}#${x.h}`, title: x.p, sub: city ? (lang === 'hi' ? city.hi : city.en) : x.c, q: x.q, u: x.u, icon: 'pin' });
            html += row(items.at(-1)!, items.length - 1);
          }
        }
        const ot = extra.others
          .map((x) => ({ x, s: score(q, [x.n]) }))
          .filter((x) => x.s >= 45)
          .sort((a, b) => b.s - a.s)
          .slice(0, 5);
        if (ot.length) {
          html += head(T.others);
          for (const { x } of ot) {
            const near = x.near ? cityBySlug.get(x.near) : null;
            const sub = `${x.st}${near ? ` · ${T.near} ${lang === 'hi' ? near.hi : near.en}` : ''} · ${T.map}`;
            items.push({ href: `${T.home}#map=8/${x.la}/${x.lo}`, title: x.n, sub, q: x.q, u: null, icon: 'map' });
            html += row(items.at(-1)!, items.length - 1);
          }
        }
      }
      if (!items.length) html = `<p class="px-3 py-6 t-small text-[var(--color-fg-muted)]">${esc(T.none)}</p>`;
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    box.innerHTML = html;
    input.setAttribute('aria-activedescendant', items.length ? `pal-${active}` : '');
  }

  function setActive(i: number) {
    active = i;
    box.querySelectorAll<HTMLElement>('[role=option]').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.i) === i)));
    box.querySelector<HTMLElement>(`#pal-${i}`)?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `pal-${i}`);
  }

  function open(prefill = '') {
    if (!dialog!.open) dialog!.showModal();
    input.value = prefill;
    active = 0;
    render();
    input.focus();
    void load();
  }
  (window as unknown as { openSearch?: (q?: string) => void }).openSearch = open;

  document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', () => open()));
  document.querySelectorAll<HTMLInputElement>('[data-search-open-on-focus]').forEach((i) => {
    const go = (e: Event) => {
      e.preventDefault();
      const v = i.value;
      i.blur();
      open(v);
    };
    i.addEventListener('focus', go);
    i.addEventListener('pointerdown', go);
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !dialog.open) {
      e.preventDefault();
      open();
    }
  });
  dialog.querySelector('[data-palette-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  box.addEventListener('pointermove', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[role=option]');
    if (el && Number(el.dataset.i) !== active) setActive(Number(el.dataset.i));
  });
  box.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    // "Use my location" was tapped: the home page starts locating on arrival.
    if (a.getAttribute('href')?.endsWith('#near')) {
      try {
        sessionStorage.setItem('locateNow', '1');
      } catch {
        /* ignore */
      }
    }
    // Same-page targets (#near, #map=…) need the dialog closed to show the change.
    if (a.getAttribute('href')?.startsWith(`${T.home}#`) && location.pathname === T.home) {
      dialog.close();
      if (a.getAttribute('href')!.endsWith('#near')) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('[data-locate-main]')?.click();
      }
    }
  });
  input.addEventListener('keydown', (e) => {
    const n = items.length;
    if (!n) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((active + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((active - 1 + n) % n);
    } else if (e.key === 'Enter') {
      const a = box.querySelector<HTMLAnchorElement>(`#pal-${active}`);
      if (a) {
        e.preventDefault();
        a.click();
      }
    }
  });
}
