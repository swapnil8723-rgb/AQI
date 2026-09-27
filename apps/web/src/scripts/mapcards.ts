/**
 * Tap/hover cards for the India map and station maps (DESIGN.md §4.16).
 * Desktop: hover or focus shows the card, click follows the link.
 * Touch: first tap shows the card, second tap (or the card link) follows it.
 * Everything is also reachable without JS — every dot is a real link.
 */

const FILL: Record<string, string> = {
  good: 'var(--color-good)', satisfactory: 'var(--color-satisfactory)', moderate: 'var(--color-moderate)',
  poor: 'var(--color-poor)', verypoor: 'var(--color-verypoor)', severe: 'var(--color-severe)', none: 'var(--color-nodata)',
};
const ON: Record<string, string> = { severe: '#FFFFFF', none: 'var(--color-fg-muted)' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

document.querySelectorAll<HTMLElement>('[data-map]').forEach((map) => {
  const card = map.querySelector<HTMLElement>('[data-map-card]');
  if (!card || map.dataset.cardsReady) return;
  map.dataset.cardsReady = '1';
  let current: Element | null = null;
  let touch = false;

  const labels = JSON.parse(map.querySelector('[data-card-labels]')?.textContent ?? '{}') as { n: string[]; u: string[]; link: string; none: string };
  const SLOTS = ['good', 'satisfactory', 'moderate', 'poor', 'verypoor', 'severe'];
  const idxN = (a: number) => (a <= 50 ? 0 : a <= 100 ? 1 : a <= 200 ? 2 : a <= 300 ? 3 : a <= 400 ? 4 : 5);
  const idxU = (a: number) => (a <= 50 ? 0 : a <= 100 ? 1 : a <= 150 ? 2 : a <= 200 ? 3 : a <= 300 ? 4 : 5);

  function show(a: SVGAElement | HTMLAnchorElement) {
    const us = document.documentElement.dataset.scale === 'us';
    const raw = us ? a.dataset.u : a.dataset.v;
    const num = raw ? Number(raw) : null;
    const i = num === null ? -1 : us ? idxU(num) : idxN(num);
    const v = num === null ? '–' : String(num);
    const cat = i < 0 ? labels.none : (us ? labels.u : labels.n)[i] ?? '';
    const slot = i < 0 ? 'none' : SLOTS[i]!;
    const href = a.getAttribute('href') ?? '#';
    card!.innerHTML =
      `<p class="t-h3">${esc(a.dataset.n ?? '')}</p>` +
      `<p class="mt-2 flex items-center gap-2"><span class="font-mono tabular text-[28px] leading-none">${esc(v)}</span>` +
      `<span class="pill" style="background:${FILL[slot]};color:${ON[slot] ?? '#0A0A0A'}">${esc(cat)}</span></p>` +
      (a.dataset.s ? `<p class="t-small text-[var(--color-fg-subtle)] mt-2 font-mono">${esc(a.dataset.s)}</p>` : '') +
      `<a class="t-small font-medium underline mt-3 inline-block" href="${esc(href)}">${esc(labels.link ?? '')} →</a>`;
    card!.hidden = false;
    card!.classList.remove('hidden');
    const box = map.getBoundingClientRect();
    const dot = a.getBoundingClientRect();
    const cx = dot.left + dot.width / 2 - box.left;
    const cy = dot.top + dot.height / 2 - box.top;
    const w = card!.offsetWidth;
    const h = card!.offsetHeight;
    let left = cx + 16;
    if (left + w > box.width - 8) left = cx - w - 16;
    left = Math.max(8, left);
    let top = cy - h / 2;
    top = Math.max(8, Math.min(top, box.height - h - 8));
    card!.style.left = `${left}px`;
    card!.style.top = `${top}px`;
    current?.removeAttribute('aria-current');
    a.setAttribute('aria-current', 'true');
    current = a;
  }
  function hide() {
    card!.classList.add('hidden');
    current?.removeAttribute('aria-current');
    current = null;
  }

  map.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
  });
  map.querySelectorAll<SVGAElement>('a[data-card]').forEach((a) => {
    a.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') show(a);
    });
    a.addEventListener('focus', () => show(a));
    a.addEventListener('click', (e) => {
      if (touch && current !== a) {
        e.preventDefault();
        show(a);
      }
    });
  });
  map.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('click', (e) => {
    if (!map.contains(e.target as Node)) hide();
  });
});

// A module, not a global script: keeps names like FILL private to this file.
export {};
