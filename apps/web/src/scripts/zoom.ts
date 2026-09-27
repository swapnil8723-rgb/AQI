/**
 * Pan and zoom for the static SVG maps, no map library (~2 KB).
 *
 * The SVG's viewBox is the camera. Dots keep their screen size because their
 * radius is `calc(var(--r) / var(--z))` in CSS, so zooming spreads crowded
 * dots apart instead of just enlarging them.
 *
 * Gestures: + / − / reset buttons; double-click or double-tap; Ctrl/⌘ + wheel
 * and trackpad pinch (plain wheel still scrolls the page — no scroll-jacking);
 * two-finger pinch on touch; drag to pan once zoomed (one finger on touch).
 * Keyboard: + − 0 and arrow keys when the map has focus.
 */

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Zoom factor relative to the full map. */
  k: number;
}

export interface ZoomApi {
  view(): View;
  zoomTo(cx: number, cy: number, k: number, animate?: boolean): void;
  reset(): void;
  /** SVG user coordinates of a client (screen) point. */
  toSvg(clientX: number, clientY: number): { x: number; y: number };
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachZoom(root: HTMLElement, onChange?: (v: View) => void, maxZoom = 12): ZoomApi | null {
  const svg = root.querySelector<SVGSVGElement>('svg[data-zoom-svg]');
  if (!svg) return null;
  const [bx, by, bw, bh] = (svg.getAttribute('viewBox') ?? '0 0 100 100').split(/\s+/).map(Number) as [number, number, number, number];
  let v: View = { x: bx, y: by, w: bw, h: bh, k: 1 };
  let anim = 0;
  const hint = root.querySelector<HTMLElement>('[data-zoom-hint]');
  let hintTimer = 0;

  function clamp(n: View): View {
    const w = Math.min(bw, Math.max(bw / maxZoom, n.w));
    const h = (w / bw) * bh;
    const x = Math.min(bx + bw - w, Math.max(bx, n.x));
    const y = Math.min(by + bh - h, Math.max(by, n.y));
    return { x, y, w, h, k: bw / w };
  }

  function apply(n: View) {
    v = clamp(n);
    svg!.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
    root.style.setProperty('--z', v.k.toFixed(3));
    // Render scale (screen px per SVG unit at full view), for sizes fixed on screen.
    const ctm = svg!.getScreenCTM();
    root.style.setProperty('--s', (ctm && ctm.a > 0 ? ctm.a / v.k : (svg!.getBoundingClientRect().width || bw) / bw).toFixed(3));
    root.toggleAttribute('data-zoomed', v.k > 1.02);
    // Zoomed in: one finger pans the map. Full view: one finger scrolls the page.
    svg!.style.touchAction = v.k > 1.02 ? 'none' : 'pan-y';
    root.dispatchEvent(new CustomEvent('mapview', { detail: v }));
    onChange?.(v);
  }

  function animateTo(n: View) {
    cancelAnimationFrame(anim);
    const from = { ...v };
    const to = clamp(n);
    if (reduced()) return apply(to);
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 220);
      const e = 1 - Math.pow(1 - p, 3);
      apply({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e, k: 0 });
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /** Screen → SVG units via the screen CTM, which accounts for letterboxing (max-height maps). */
  function toSvg(cx: number, cy: number) {
    const m = svg!.getScreenCTM();
    if (!m) {
      const r = svg!.getBoundingClientRect();
      return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h };
    }
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  /** Pan so the SVG point under screen point `a` moves to screen point `b`. */
  function panBy(a: { x: number; y: number }, b: { x: number; y: number }) {
    const p = toSvg(a.x, a.y);
    const q = toSvg(b.x, b.y);
    apply({ ...v, x: v.x - (q.x - p.x), y: v.y - (q.y - p.y) });
  }

  /** Zoom by `factor` keeping the SVG point (px, py) fixed on screen. */
  function zoomAround(px: number, py: number, factor: number, animate = false) {
    const w = v.w / factor;
    const h = v.h / factor;
    const n = { x: px - (px - v.x) * (w / v.w), y: py - (py - v.y) * (h / v.h), w, h, k: 0 };
    animate ? animateTo(n) : apply(n);
  }

  function zoomTo(cx: number, cy: number, k: number, animate = true) {
    const w = bw / k;
    const h = bh / k;
    const n = { x: cx - w / 2, y: cy - h / 2, w, h, k: 0 };
    animate ? animateTo(n) : apply(n);
  }

  const reset = () => animateTo({ x: bx, y: by, w: bw, h: bh, k: 1 });

  function showHint() {
    if (!hint) return;
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => (hint.hidden = true), 1400);
  }

  // Buttons
  root.querySelectorAll<HTMLButtonElement>('[data-zoom-btn]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      if (b.dataset.zoomBtn === 'in') zoomAround(c.x, c.y, 2, true);
      else if (b.dataset.zoomBtn === 'out') zoomAround(c.x, c.y, 0.5, true);
      else reset();
    }),
  );

  // Wheel: only with Ctrl/⌘ (a trackpad pinch arrives as ctrl+wheel).
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        showHint();
        return;
      }
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAround(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)));
    },
    { passive: false },
  );

  // Double-click / double-tap zooms in at the point.
  let touchZoomAt = 0;
  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    // Some phones fire dblclick after our own double-tap handling: zoom once.
    if (performance.now() - touchZoomAt < 500) return;
    const p = toSvg(e.clientX, e.clientY);
    zoomAround(p.x, p.y, 2, true);
  });

  // Pointers: drag to pan when zoomed; two-finger pinch.
  const pts = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let start: { x: number; y: number } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  svg.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    start = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, cur);
    if (start && Math.hypot(cur.x - start.x, cur.y - start.y) > 5) dragged = true;
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Pan by the midpoint's travel, then zoom around the new midpoint.
      panBy({ x: pinch.mx, y: pinch.my }, { x: mx, y: my });
      const p = toSvg(mx, my);
      if (pinch.d > 0) zoomAround(p.x, p.y, d / pinch.d);
      pinch = { d, mx, my };
      return;
    }
    if (v.k > 1.02 && pts.size === 1 && dragged) {
      panBy(prev, cur);
      svg.setPointerCapture?.(e.pointerId);
    }
  });
  const end = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (e.type === 'pointerup' && e.pointerType !== 'mouse' && !dragged) {
      const now = performance.now();
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        const p = toSvg(e.clientX, e.clientY);
        zoomAround(p.x, p.y, 2, true);
        touchZoomAt = now;
        lastTap = { t: 0, x: 0, y: 0 };
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  // A drag must not also click the dot it started on.
  root.addEventListener(
    'click',
    (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    },
    true,
  );

  root.addEventListener('keydown', (e) => {
    const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const step = v.w * 0.15;
    const k = e.key;
    if (k === '+' || k === '=') zoomAround(c.x, c.y, 2, true);
    else if (k === '-' || k === '_') zoomAround(c.x, c.y, 0.5, true);
    else if (k === '0') reset();
    else if (v.k > 1.02 && k.startsWith('Arrow')) {
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      animateTo({ ...v, x: v.x + dx, y: v.y + dy });
    } else return;
    e.preventDefault();
  });

  apply(v);
  return { view: () => v, zoomTo, reset, toSvg };
}
