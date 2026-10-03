/**
 * Tap/hover cards for the maps (DESIGN.md §4.16), by event delegation so dots
 * added later (stations on zoom, replay) work too. Desktop: hover or focus
 * shows the card, click follows the link. Touch: first tap shows the card,
 * second tap (or the card link) follows it. Every dot is also a real link.
 */

const FILL: Record<string, string> = {
  good: 'var(--color-good)', satisfactory: 'var(--color-satisfactory)', moderate: 'var(--color-moderate)',
  poor: 'var(--color-poor)', verypoor: 'var(--color-verypoor)', severe: 'var(--color-severe)', none: 'var(--color-nodata)',
};
const ON: Record<string, string> = { severe: '#FFFFFF', none: 'var(--color-fg-muted)' };
const SLOTS = ['good', 'satisfactory', 'moderate', 'poor', 'verypoor', 'severe'];
const idxN = (a: number) => (a <= 50 ? 0 : a <= 100 ? 1 : a <= 200 ? 2 : a <= 300 ? 3 : a <= 400 ? 4 : 5);
const idxU = (a: number) => (a <= 50 ? 0 : a <= 100 ? 1 : a <= 150 ? 2 : a <= 200 ? 3 : a <= 300 ? 4 : 5);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function hideCard(map: HTMLElement) {
  map.querySelector<HTMLElement>('[data-map-card]')?.classList.add('hidden');
  map.querySelector('[aria-current]')?.removeAttribute('aria-current');
}

document.querySelectorAll<HTMLElement>('[data-map]').forEach((map) => {
  const card = map.querySelector<HTMLElement>('[data-map-card]');
  if (!card || map.dataset.cardsReady) return;
  map.dataset.cardsReady = '1';
  const labels = JSON.parse(map.querySelector('[data-card-labels]')?.textContent ?? '{}') as {
    n: string[]; u: string[]; link: string; none: string; zoom?: string; ctx?: string;
  };
  let current: Element | null = null;
  let touch = false;

  function show(a: SVGAElement) {
    const us = document.documentElement.dataset.scale === 'us';
    const raw = us ? a.dataset.u : a.dataset.v;
    const num = raw ? Number(raw) : null;
    const i = num === null ? -1 : us ? idxU(num) : idxN(num);
    const cat = i < 0 ? labels.none : ((us ? labels.u : labels.n)[i] ?? '');
    const slot = i < 0 ? 'none' : SLOTS[i]!;
    const href = a.getAttribute('href') ?? '#';
    // A city without a page links to #map=…: its action zooms the map there.
    const action = a.dataset.l ?? (href.includes('#map=') ? labels.zoom : labels.link) ?? '';
    const sub = a.dataset.s ?? (a.dataset.st ? `${a.dataset.st}${labels.ctx ? ` · ${labels.ctx}` : ''}` : '');
    card!.innerHTML =
      `<p class="t-h3">${esc(a.dataset.n ?? '')}</p>` +
      `<p class="mt-2 flex items-center gap-2"><span class="font-mono tabular text-[28px] leading-none">${num === null ? '–' : num}</span>` +
      `<span class="pill" style="background:${FILL[slot]};color:${ON[slot] ?? '#0A0A0A'}">${esc(cat)}</span></p>` +
      (sub ? `<p class="t-small text-[var(--color-fg-subtle)] mt-2 font-mono">${esc(sub)}</p>` : '') +
      // CPCB's own bulletin figure, beside the estimate (India scale only: the bulletin has no US value).
      (a.dataset.o && !us ? `<p class="t-small text-[var(--color-fg-muted)] mt-1 font-mono">${esc(a.dataset.o)}</p>` : '') +
      (href !== '#' ? `<a class="t-small font-medium underline mt-3 inline-block" href="${esc(href)}">${esc(action)} →</a>` : '');
    card!.classList.remove('hidden');
    const box = map.getBoundingClientRect();
    const dot = (a.querySelector('.map-dot') ?? a).getBoundingClientRect();
    const cx = dot.left + dot.width / 2 - box.left;
    const cy = dot.top + dot.height / 2 - box.top;
    const w = card!.offsetWidth;
    const h = card!.offsetHeight;
    // Beside the dot if it fits; on a phone it rarely does, so then below it (or
    // above, near the bottom edge) — never on top of the dot it describes.
    let left: number;
    let top: number;
    if (cx + 16 + w <= box.width - 8 || cx - 16 - w >= 8) {
      left = cx + 16 + w <= box.width - 8 ? cx + 16 : cx - w - 16;
      top = Math.max(8, Math.min(cy - h / 2, box.height - h - 8));
    } else {
      left = Math.max(8, Math.min(cx - w / 2, box.width - w - 8));
      top = cy + 20 + h <= box.height - 8 ? cy + 20 : Math.max(8, cy - 20 - h);
    }
    card!.style.left = `${left}px`;
    card!.style.top = `${top}px`;
    current?.removeAttribute('aria-current');
    a.setAttribute('aria-current', 'true');
    current = a;
  }
  const dotOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<SVGAElement>('a[data-card]') : null);
  /**
   * The dot nearest the pointer, among every dot whose hit area is under it.
   * Hit areas are 44 px, so neighbours overlap (Mumbai and Pune at full view);
   * the topmost one is not necessarily the one the finger was aimed at.
   */
  function pick(x: number, y: number, fallback: EventTarget | null): SVGAElement | null {
    let best: SVGAElement | null = null;
    let bestD = Infinity;
    for (const el of document.elementsFromPoint(x, y)) {
      if (!el.matches('.hit, .map-dot')) continue;
      const a = dotOf(el);
      const dot = a?.querySelector('.map-dot');
      if (!a || !dot) continue;
      const r = dot.getBoundingClientRect();
      if (!r.width) continue;
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bestD) [best, bestD] = [a, d];
    }
    return best ?? dotOf(fallback);
  }
  // The card that was open before this tap. A tap focuses the link before its
  // click fires (Android), and focus opens the card, so by click time `current`
  // already equals the tapped dot; comparing with it would navigate on the first tap.
  let before: Element | null = null;

  map.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
    before = current;
  });
  let frame = 0;
  map.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const a = pick(e.clientX, e.clientY, e.target);
      if (a && a !== current) show(a);
    });
  });
  map.addEventListener('focusin', (e) => {
    const a = dotOf(e.target);
    if (a && a !== current) show(a);
  });
  map.addEventListener('click', (e) => {
    const hit = dotOf(e.target);
    if (!hit) return;
    // Keyboard (Enter) clicks have no position: keep the focused dot.
    const a = e.detail === 0 ? hit : (pick(e.clientX, e.clientY, e.target) ?? hit);
    const href = a.getAttribute('href') ?? '#';
    if ((touch && before !== a) || href === '#') {
      e.preventDefault();
      show(a);
    } else if (a !== hit) {
      // A neighbour's hit area was on top: follow the nearer dot instead.
      e.preventDefault();
      location.assign(href);
    }
    before = current;
  });
  map.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      hideCard(map);
      current = null;
    }
  });
  // Any pan or zoom closes the card (it would point at the wrong place).
  map.addEventListener('mapview', () => {
    hideCard(map);
    current = null;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCard(map);
  });
  document.addEventListener('click', (e) => {
    if (!map.contains(e.target as Node)) hideCard(map);
  });
});
