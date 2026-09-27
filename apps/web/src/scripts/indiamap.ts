/**
 * The home map, enhanced: zoom and pan (zoom.ts), labels that follow the
 * camera, every CPCB station once zoomed past 2.5× (fetched on demand), a
 * #map=zoom/lat/lon deep link, and the replay of CPCB's official daily AQI.
 */
import { attachZoom, type View } from './zoom.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
const SLOT = (a: number | null) =>
  a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 200 ? 'moderate' : a <= 300 ? 'poor' : a <= 400 ? 'verypoor' : 'severe';
const USLOT = (a: number | null) =>
  a === null ? 'none' : a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 150 ? 'moderate' : a <= 200 ? 'poor' : a <= 300 ? 'verypoor' : 'severe';

interface Lite { p: string; c: string; s: string | null; h?: string | null; la: number; lo: number; a: number | null; u: number | null; t: string | null }
interface ReplayCity { n: string; la: number; lo: number; s: string | null; v: (number | null)[] }
interface Replay { dates: string[]; mark?: { date: string; label: string }; cities: ReplayCity[] }
interface Text { stationsLoading: string; worst: string; diwali: string; seeStation: string; official: string; play: string; pause: string; months: string[] }

const root = document.querySelector<HTMLElement>('[data-map][data-india]');
if (root) {
  const merc = JSON.parse(root.dataset.mercator ?? '{"k":1,"tx":0,"ty":0}') as { k: number; tx: number; ty: number };
  const base = root.dataset.base ?? '/aqi/';
  const text = JSON.parse(root.querySelector('[data-map-text]')?.textContent ?? '{}') as Text;
  const svg = root.querySelector<SVGSVGElement>('svg[data-zoom-svg]')!;
  const [, , BW] = (svg.getAttribute('viewBox') ?? '0 0 560 616').split(' ').map(Number) as [number, number, number];
  const project = (lat: number, lon: number): [number, number] => {
    const λ = (lon * Math.PI) / 180;
    const φ = (lat * Math.PI) / 180;
    return [merc.tx + merc.k * λ, merc.ty - merc.k * Math.log(Math.tan(Math.PI / 4 + φ / 2))];
  };
  // Big cities (always-on labels) first, so they win label collisions.
  const labels = [...root.querySelectorAll<HTMLElement>('.map-label[data-x]')].sort(
    (a, b) => Number(a.classList.contains('lbl-minor')) - Number(b.classList.contains('lbl-minor')),
  );
  const stationLayer = root.querySelector<SVGGElement>('[data-station-layer]')!;
  const loading = root.querySelector<HTMLElement>('[data-stations-loading]');
  let stations: 'none' | 'loading' | 'done' = 'none';
  const hhmm = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(Date.parse(iso) + 330 * 60_000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };

  function place(v: View) {
    const w = svg.getBoundingClientRect().width || 1;
    for (const el of labels) {
      el.style.display = '';
      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      const off = (Number(el.dataset.off) * w) / BW + 2;
      const px = ((x - v.x) / v.w) * w;
      const py = ((y - v.y) / v.h) * ((v.h / v.w) * w);
      const inside = x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
      el.style.visibility = inside ? '' : 'hidden';
      el.style.top = `${py}px`;
      if (el.dataset.side === 'l') {
        el.style.left = '';
        el.style.right = `${w - px + off}px`;
      } else {
        el.style.right = '';
        el.style.left = `${px + off}px`;
      }
    }
    // Collision pass: labels are in priority order (big cities first); hide any
    // that would overlap one already placed. Zooming further brings them back.
    const placed: DOMRect[] = [];
    for (const el of labels) {
      if (el.style.visibility === 'hidden' || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (placed.some((p) => r.left < p.right + 4 && r.right > p.left - 4 && r.top < p.bottom && r.bottom > p.top)) el.style.display = 'none';
      else placed.push(r);
    }
  }

  async function loadStations() {
    if (stations !== 'none') return;
    stations = 'loading';
    loading?.classList.remove('hidden');
    try {
      const r = await fetch('/api/stations.json');
      const { stations: list } = (await r.json()) as { stations: Lite[] };
      const frag = document.createDocumentFragment();
      // Worst on top.
      for (const s of list.filter((x) => x.a !== null).sort((a, b) => (a.a ?? 0) - (b.a ?? 0))) {
        const [x, y] = project(s.la, s.lo);
        const a = document.createElementNS(SVGNS, 'a');
        a.setAttribute('href', s.s ? `${base}${s.s}${s.h ? `#${s.h}` : ''}` : '#');
        a.dataset.card = '';
        a.dataset.n = s.p;
        a.dataset.v = String(s.a);
        a.dataset.u = s.u === null ? '' : String(s.u);
        a.dataset.s = `${s.c}${s.t ? ` · ${hhmm(s.t)}` : ''}`;
        a.dataset.l = text.seeStation;
        a.setAttribute('aria-label', `${s.p}, ${s.c}: AQI ${s.a}`);
        const hit = document.createElementNS(SVGNS, 'circle');
        hit.setAttribute('class', 'hit');
        hit.setAttribute('style', '--r:10');
        const dot = document.createElementNS(SVGNS, 'circle');
        dot.setAttribute('class', 'map-dot st-dot');
        dot.dataset.aqi = SLOT(s.a);
        dot.dataset.aqiUs = USLOT(s.u);
        const num = document.createElementNS(SVGNS, 'text');
        num.setAttribute('class', 'st-num');
        num.dataset.aqi = SLOT(s.a);
        num.innerHTML = `<tspan class="v-n">${s.a}</tspan><tspan class="v-us">${s.u ?? '–'}</tspan>`;
        for (const el of [hit, dot, num]) {
          el.setAttribute(el === num ? 'x' : 'cx', String(x.toFixed(2)));
          el.setAttribute(el === num ? 'y' : 'cy', String(y.toFixed(2)));
        }
        a.append(hit, dot, num);
        frag.append(a);
      }
      stationLayer.append(frag);
      stations = 'done';
    } catch {
      stations = 'none';
    } finally {
      loading?.classList.add('hidden');
    }
  }

  const zoom = attachZoom(root, (v) => {
    place(v);
    root.toggleAttribute('data-deep', v.k >= 2.5);
    root.toggleAttribute('data-deeper', v.k >= 5);
    if (v.k >= 2.5) void loadStations();
  }, 16);

  // #map=zoom/lat/lon (search results for cities without a page link here).
  function fromHash() {
    const m = /^#map=([\d.]+)\/([\d.]+)\/([\d.]+)$/.exec(location.hash);
    if (!m || !zoom) return;
    const [x, y] = project(Number(m[2]), Number(m[3]));
    zoom.zoomTo(x, y, Math.min(16, Number(m[1])), false);
    root!.scrollIntoView({ block: 'center' });
  }
  fromHash();
  addEventListener('hashchange', fromHash);
  addEventListener('resize', () => zoom && place(zoom.view()));
  if (zoom) place(zoom.view());

  // ── Replay ───────────────────────────────────────────────────────────
  const layer = root.querySelector<SVGGElement>('[data-replay-layer]')!;
  const bar = document.querySelector<HTMLElement>('[data-replay-bar]');
  const controls = document.querySelector<HTMLElement>('[data-replay-controls]');
  const range = document.querySelector<HTMLInputElement>('[data-replay-range]');
  const dateEl = document.querySelector<HTMLElement>('[data-replay-date]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-replay-toggle]');
  const hud = root.querySelector<HTMLElement>('[data-replay-hud]');
  const noteLive = document.querySelector<HTMLElement>('[data-map-note]');
  const noteReplay = document.querySelector<HTMLElement>('[data-replay-note]');
  const cache = new Map<string, Replay>();
  let data: Replay | null = null;
  let dots: SVGCircleElement[] = [];
  let links: SVGAElement[] = [];
  let frame = 0;
  let timer = 0;

  const fmt = (d: string) => `${Number(d.slice(8))} ${text.months[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

  function setFrame(i: number) {
    if (!data) return;
    frame = i;
    let worst: { n: string; v: number } | null = null;
    data.cities.forEach((c, k) => {
      const v = c.v[i] ?? null;
      dots[k]!.dataset.aqi = SLOT(v);
      dots[k]!.style.opacity = v === null ? '0.15' : '1';
      links[k]!.dataset.v = v === null ? '' : String(v);
      links[k]!.dataset.s = `${text.official} · ${fmt(data!.dates[i]!)}`;
      if (v !== null && (!worst || v > worst.v)) worst = { n: c.n, v };
    });
    const d = data.dates[i]!;
    const mark = data.mark?.date === d ? ` · ${text.diwali}` : '';
    if (range) range.value = String(i);
    if (dateEl) dateEl.textContent = fmt(d);
    if (hud) {
      hud.classList.remove('hidden');
      const w = worst as { n: string; v: number } | null;
      hud.innerHTML = `<strong class="font-semibold">${fmt(d)}${mark}</strong>${w ? `<br><span class="text-[var(--color-fg-muted)]">${text.worst}: ${w.n} ${w.v}</span>` : ''}`;
    }
  }

  function play() {
    stop();
    if (!data) return;
    if (frame >= data.dates.length - 1) setFrame(0);
    toggle!.textContent = '❚❚';
    toggle!.setAttribute('aria-label', text.pause);
    const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1400 : 650;
    timer = window.setInterval(() => {
      if (!data || frame >= data.dates.length - 1) return stop();
      setFrame(frame + 1);
    }, speed);
  }
  function stop() {
    clearInterval(timer);
    timer = 0;
    if (toggle) {
      toggle.textContent = '▶';
      toggle.setAttribute('aria-label', text.play);
    }
  }

  async function start(kind: string) {
    let d = cache.get(kind);
    if (!d) {
      const url = kind === '30d' ? '/api/replay.json' : `/replay/${kind}.json`;
      try {
        d = (await (await fetch(url)).json()) as Replay;
      } catch {
        return;
      }
      cache.set(kind, d);
    }
    if (!d.dates?.length) return;
    data = d;
    layer.replaceChildren();
    dots = [];
    links = [];
    const frag = document.createDocumentFragment();
    for (const c of d.cities) {
      const [x, y] = project(c.la, c.lo);
      const a = document.createElementNS(SVGNS, 'a') as SVGAElement;
      a.setAttribute('href', c.s ? `${base}${c.s}` : '#');
      a.dataset.card = '';
      a.dataset.n = c.n;
      const hit = document.createElementNS(SVGNS, 'circle');
      hit.setAttribute('class', 'hit');
      hit.setAttribute('style', '--r:9');
      const dot = document.createElementNS(SVGNS, 'circle') as SVGCircleElement;
      dot.setAttribute('class', 'map-dot thin');
      dot.setAttribute('style', `--r:${c.s ? 6 : 3.6}`);
      for (const el of [hit, dot]) {
        el.setAttribute('cx', x.toFixed(2));
        el.setAttribute('cy', y.toFixed(2));
      }
      a.append(hit, dot);
      frag.append(a);
      dots.push(dot);
      links.push(a);
    }
    layer.append(frag);
    root!.dataset.mode = 'replay';
    bar?.classList.add('hidden');
    controls?.classList.remove('hidden');
    controls?.classList.add('flex');
    noteLive?.classList.add('hidden');
    noteReplay?.classList.remove('hidden');
    if (range) range.max = String(d.dates.length - 1);
    const markAt = d.mark ? d.dates.indexOf(d.mark.date) : -1;
    // Diwali: start a week before, so the rise is visible.
    setFrame(markAt > 7 ? markAt - 7 : 0);
    play();
  }

  function close() {
    stop();
    data = null;
    layer.replaceChildren();
    delete root!.dataset.mode;
    bar?.classList.remove('hidden');
    controls?.classList.add('hidden');
    controls?.classList.remove('flex');
    hud?.classList.add('hidden');
    noteLive?.classList.remove('hidden');
    noteReplay?.classList.add('hidden');
  }

  document.querySelectorAll<HTMLButtonElement>('[data-replay-start]').forEach((b) => b.addEventListener('click', () => start(b.dataset.replayStart!)));
  toggle?.addEventListener('click', () => (timer ? stop() : play()));
  range?.addEventListener('input', () => {
    stop();
    setFrame(Number(range.value));
  });
  document.querySelector('[data-replay-close]')?.addEventListener('click', close);
}
