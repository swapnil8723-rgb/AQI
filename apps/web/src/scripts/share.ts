/** Draws the share card (DESIGN.md §4.11) on a canvas and shares it. */

interface CardData {
  city: string;
  cityAlt: string;
  aqi: number;
  us: number | null;
  cat: string;
  catAlt: string;
  catUs: string;
  slot: string;
  slotUs: string;
  main: string;
  worst: string | null;
  cleanest: string | null;
  date: string;
  url: string;
  brand: string;
  live: string;
  text: string;
  mainLabel: string;
  worstLabel: string;
  cleanestLabel: string;
}

const FILL: Record<string, string> = {
  good: '#00B050', satisfactory: '#92D050', moderate: '#FFE600', poor: '#FF9900', verypoor: '#FF0000', severe: '#A50021', none: '#E5E5E5',
};

async function draw(s: CardData): Promise<Blob> {
  const us = document.documentElement.dataset.scale === 'us' && s.us !== null;
  const slot = us ? s.slotUs : s.slot;
  const W = 1080;
  const H = 1350;
  const top = Math.round(H * 0.62);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sans = '"Geist Variable", "Noto Sans Devanagari", system-ui, sans-serif';
  const mono = '"Geist Mono Variable", ui-monospace, monospace';
  await Promise.all([
    document.fonts.load(`600 64px "Geist Variable"`),
    document.fonts.load(`500 32px "Geist Mono Variable"`),
    document.fonts.load(`600 44px "Noto Sans Devanagari"`, 'अ'),
  ]).catch(() => undefined);

  const on = slot === 'severe' ? '#FFFFFF' : '#0A0A0A';
  g.fillStyle = FILL[slot] ?? FILL.none!;
  g.fillRect(0, 0, W, top);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, top, W, H - top);

  const pad = 80;
  g.fillStyle = on;
  g.textBaseline = 'alphabetic';
  g.font = `500 30px ${mono}`;
  g.fillText(`${s.live.toUpperCase()} · ${s.date}`, pad, 120);
  g.font = `600 64px ${sans}`;
  g.fillText(s.city, pad, 210);
  g.font = `600 280px ${sans}`;
  g.fillText(String(us ? s.us : s.aqi), pad - 12, 500);
  g.font = `600 56px ${sans}`;
  g.fillText(us ? s.catUs : s.cat, pad, 600);
  if (!us) {
    g.font = `600 48px ${sans}`;
    g.globalAlpha = 0.85;
    g.fillText(s.catAlt, pad, 672);
    g.globalAlpha = 1;
  }
  g.font = `500 28px ${mono}`;
  g.fillText(us ? 'US EPA SCALE (FOR COMPARISON)' : 'NATIONAL AQI · CPCB STATIONS', pad, top - 60);

  g.fillStyle = '#171717';
  const rows: [string, string][] = [[s.mainLabel, s.main]];
  if (s.worst) rows.push([s.worstLabel, s.worst]);
  if (s.cleanest) rows.push([s.cleanestLabel, s.cleanest]);
  let y = top + 110;
  for (const [k, v] of rows) {
    g.fillStyle = '#666666';
    g.font = `500 26px ${mono}`;
    g.fillText(k.toUpperCase(), pad, y);
    g.fillStyle = '#171717';
    g.font = `600 44px ${sans}`;
    g.fillText(v, pad, y + 54);
    y += 125;
  }
  g.font = `600 44px ${sans}`;
  const brand = s.brand.toLowerCase();
  g.fillStyle = '#171717';
  g.fillText(brand, pad, H - 80);
  const bw = g.measureText(brand).width;
  g.fillStyle = FILL[slot] ?? '#171717';
  g.beginPath();
  g.arc(pad + bw + 16, H - 94, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4D4D4D';
  g.font = `500 28px ${mono}`;
  const u = s.url.replace(/^https?:\/\//, '');
  g.fillText(u, W - pad - g.measureText(u).width, H - 82);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}

async function share() {
  const el = document.getElementById('share-data');
  if (!el) return;
  const s = JSON.parse(el.textContent ?? '{}') as CardData;
  try {
    const blob = await draw(s);
    const file = new File([blob], `${s.city.toLowerCase().replace(/\s+/g, '-')}-aqi.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: s.text });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return; // user closed the share sheet
    window.open(`https://wa.me/?text=${encodeURIComponent(s.text)}`, '_blank', 'noopener');
  }
}

document.querySelectorAll('[data-share-trigger]').forEach((b) => b.addEventListener('click', share));

// A module, not a global script: keeps names like FILL private to this file.
export {};
