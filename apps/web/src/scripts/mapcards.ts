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
  const labels = JSON.parse(map.querySelector('[data-card-labels]')?.textContent ?? '{}') as { n: string[]; u: string[]; link: string; none: string };
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
    card!.innerHTML =
      `<p class="t-h3">${esc(a.dataset.n ?? '')}</p>` +
      `<p class="mt-2 flex items-center gap-2"><span class="font-mono tabular text-[28px] leading-none">${num === null ? '–' : num}</span>` +
      `<span class="pill" style="background:${FILL[slot]};color:${ON[slot] ?? '#0A0A0A'}">${esc(cat)}</span></p>` +
      (a.dataset.s ? `<p class="t-small text-[var(--color-fg-subtle)] mt-2 font-mono">${esc(a.dataset.s)}</p>` : '') +
      (href !== '#' ? `<a class="t-small font-medium underline mt-3 inline-block" href="${esc(href)}">${esc(a.dataset.l ?? labels.link ?? '')} →</a>` : '');
    card!.classList.remove('hidden');
    const box = map.getBoundingClientRect();
    const dot = (a.querySelector('.map-dot') ?? a).getBoundingClientRect();
    const cx = dot.left + dot.width / 2 - box.left;
    const cy = dot.top + dot.height / 2 - box.top;
    const w = card!.offsetWidth;
    const h = card!.offsetHeight;
    let left = cx + 16;
    if (left + w > box.width - 8) left = cx - w - 16;
    left = Math.max(8, left);
    const top = Math.max(8, Math.min(cy - h / 2, box.height - h - 8));
    card!.style.left = `${left}px`;
    card!.style.top = `${top}px`;
    current?.removeAttribute('aria-current');
    a.setAttribute('aria-current', 'true');
    current = a;
  }
  const dotOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<SVGAElement>('a[data-card]') : null);

  map.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
  });
  map.addEventListener('pointerover', (e) => {
    const a = dotOf(e.target);
    if (a && e.pointerType === 'mouse') show(a);
  });
  map.addEventListener('focusin', (e) => {
    const a = dotOf(e.target);
    if (a) show(a);
  });
  map.addEventListener('click', (e) => {
    const a = dotOf(e.target);
    if (!a) return;
    if ((touch && current !== a) || a.getAttribute('href') === '#') {
      e.preventDefault();
      show(a);
    }
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
