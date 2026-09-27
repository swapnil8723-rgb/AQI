/**
 * The share card (DESIGN.md §4.11), drawn on a canvas in the browser, and the
 * share sheet around it. Post = 1080×1350 (feeds), Status = 1080×1920
 * (WhatsApp Status / stories). English or Hindi. No emoji, no photos.
 */

interface CardText {
  city: string; cat: string; catAlt: string; catUs: string; live: string; date: string;
  main: string; mainLabel: string; worst: string | null; worstLabel: string; cleanest: string | null; cleanestLabel: string;
  official: string | null; lastYear: string | null; hoursLabel: string; scaleLine: string; usLine: string; text: string;
}
interface Card {
  aqi: number; us: number | null; slot: string; slotUs: string; url: string; brand: string;
  hours: (number | null)[]; en: CardText; hi: CardText;
}

const FILL: Record<string, string> = {
  good: '#00B050', satisfactory: '#92D050', moderate: '#FFE600', poor: '#FF9900', verypoor: '#FF0000', severe: '#A50021', none: '#E5E5E5',
};
const SLOT = (a: number) => (a <= 50 ? 'good' : a <= 100 ? 'satisfactory' : a <= 200 ? 'moderate' : a <= 300 ? 'poor' : a <= 400 ? 'verypoor' : 'severe');

async function fonts() {
  await Promise.all([
    document.fonts.load('600 64px "Geist Variable"'),
    document.fonts.load('500 32px "Geist Mono Variable"'),
    document.fonts.load('600 44px "Noto Sans Devanagari"', 'अ'),
    document.fonts.load('400 44px "Noto Sans Devanagari"', 'अ'),
  ]).catch(() => undefined);
}

export async function drawCard(card: Card, format: 'post' | 'status', lang: 'en' | 'hi'): Promise<Blob> {
  await fonts();
  const t = card[lang];
  const us = document.documentElement.dataset.scale === 'us' && card.us !== null;
  const slot = us ? card.slotUs : card.slot;
  const W = 1080;
  const H = format === 'status' ? 1920 : 1350;
  const topH = Math.round(H * (format === 'status' ? 0.5 : 0.56));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sans = lang === 'hi' ? '"Noto Sans Devanagari", "Geist Variable", sans-serif' : '"Geist Variable", "Noto Sans Devanagari", sans-serif';
  const mono = '"Geist Mono Variable", ui-monospace, monospace';
  const on = slot === 'severe' ? '#FFFFFF' : '#0A0A0A';
  const pad = 84;
  const fit = (text: string, max: number, size: number, weight = 600, family = sans) => {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (g.measureText(text).width > max && s > 20) {
      s -= 2;
      g.font = `${weight} ${s}px ${family}`;
    }
    return s;
  };

  // Top: the air's colour, the number.
  g.fillStyle = FILL[slot] ?? FILL.none!;
  g.fillRect(0, 0, W, topH);
  g.fillStyle = on;
  g.textBaseline = 'alphabetic';
  g.font = `500 30px ${mono}`;
  g.fillText(`${t.live.toUpperCase()} · ${t.date}`, pad, 124);
  fit(t.city, W - pad * 2, 76);
  g.fillText(t.city, pad, 222);
  const num = String(us ? card.us : card.aqi);
  const numSize = format === 'status' ? 340 : 300;
  g.font = `600 ${numSize}px "Geist Variable", sans-serif`;
  g.fillText(num, pad - 14, 222 + numSize * 0.92);
  const catY = 222 + numSize * 0.92 + 92;
  fit(us ? t.catUs : t.cat, W - pad * 2, 60);
  g.fillText(us ? t.catUs : t.cat, pad, catY);
  if (!us && t.catAlt) {
    g.globalAlpha = 0.8;
    g.font = `600 44px ${lang === 'hi' ? '"Geist Variable", sans-serif' : '"Noto Sans Devanagari", sans-serif'}`;
    g.fillText(t.catAlt, pad, catY + 64);
    g.globalAlpha = 1;
  }
  g.font = `500 26px ${mono}`;
  g.globalAlpha = 0.85;
  g.fillText(us ? t.usLine : t.scaleLine, pad, topH - 56);
  g.globalAlpha = 1;

  // Bottom: white, the evidence.
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, topH, W, H - topH);
  let y = topH + (format === 'status' ? 100 : 76);

  // Last 24 hours, one bar per hour in its own category colour.
  const hours = card.hours;
  if (hours.some((v) => v !== null)) {
    g.fillStyle = '#666666';
    g.font = `500 26px ${lang === 'hi' ? sans : mono}`;
    g.fillText(lang === 'hi' ? t.hoursLabel : t.hoursLabel.toUpperCase(), pad, y);
    const peak = Math.max(100, ...hours.map((v) => v ?? 0));
    const cap = [100, 200, 300, 400, 500].find((x) => peak <= x * 0.92) ?? 500;
    const chartH = format === 'status' ? 190 : 96;
    const bw = (W - pad * 2) / 24;
    hours.forEach((v, i) => {
      const x = pad + i * bw + 3;
      if (v === null) {
        g.fillStyle = '#E5E5E5';
        g.fillRect(x, y + 20 + chartH - 4, bw - 6, 4);
        return;
      }
      const h = Math.max(6, (Math.min(v, cap) / cap) * chartH);
      g.fillStyle = FILL[SLOT(v)]!;
      g.fillRect(x, y + 20 + chartH - h, bw - 6, h);
    });
    y += chartH + (format === 'status' ? 100 : 80);
  }

  const cells: [string, string][] = [[t.mainLabel, t.main]];
  if (t.official) cells.push(['CPCB · 4 PM', t.official.replace(/^.*?:\s*/, '')]);
  if (t.worst) cells.push([t.worstLabel, t.worst]);
  if (t.cleanest) cells.push([t.cleanestLabel, t.cleanest]);
  const label = (k: string, x: number, yy: number) => {
    g.fillStyle = '#666666';
    g.font = `500 24px ${lang === 'hi' ? sans : mono}`;
    g.fillText(lang === 'hi' ? k : k.toUpperCase(), x, yy);
  };
  // Two columns, two rows on both formats; Status adds the same day last year.
  const colW = (W - pad * 2) / 2;
  const rowH = format === 'status' ? 132 : 112;
  cells.slice(0, 4).forEach(([k, v], i) => {
    const x = pad + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * rowH;
    label(k, x, yy);
    g.fillStyle = '#171717';
    fit(v, colW - 24, format === 'status' ? 42 : 38);
    g.fillText(v, x, yy + (format === 'status' ? 56 : 48));
  });
  y += Math.ceil(Math.min(cells.length, 4) / 2) * rowH;
  if (format === 'status' && t.lastYear) {
    g.fillStyle = '#4D4D4D';
    fit(t.lastYear, W - pad * 2, 34, 500);
    g.fillText(t.lastYear, pad, y + 30);
  }

  // Footer: wordmark with the living dot, and the page URL.
  g.fillStyle = '#171717';
  g.font = `600 46px "Geist Variable", sans-serif`;
  const brand = card.brand.toLowerCase();
  g.fillText(brand, pad, H - 84);
  const bw2 = g.measureText(brand).width;
  g.fillStyle = FILL[slot] ?? '#171717';
  g.beginPath();
  g.arc(pad + bw2 + 17, H - 99, 10, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4D4D4D';
  g.font = `500 28px ${mono}`;
  const u = card.url.replace(/^https?:\/\//, '');
  g.fillText(u, W - pad - g.measureText(u).width, H - 86);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}

const sheet = document.querySelector<HTMLDialogElement>('[data-share-sheet]');
if (sheet) {
  const card = JSON.parse(sheet.querySelector('[data-share-card]')?.textContent ?? '{}') as Card;
  const preview = sheet.querySelector<HTMLImageElement>('[data-share-preview]')!;
  const wa = sheet.querySelector<HTMLAnchorElement>('[data-share-wa]')!;
  let format: 'post' | 'status' = 'post';
  let lang: 'en' | 'hi' = (document.documentElement.dataset.lang as 'en' | 'hi') ?? 'en';
  let blob: Blob | null = null;
  let url = '';
  const fileName = () => `${card.en.city.toLowerCase().replace(/\s+/g, '-')}-aqi-${format}.png`;

  // Quick toggles start overlapping redraws; only the newest may update the preview.
  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    const next = await drawCard(card, format, lang);
    if (mine !== seq) return;
    blob = next;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    preview.src = url;
    preview.dataset.state = `${format}-${lang}`;
    preview.width = 200;
    preview.height = format === 'status' ? 356 : 250;
    wa.href = `https://wa.me/?text=${encodeURIComponent(card[lang].text)}`;
  }

  const open = () => {
    if (!sheet.open) sheet.showModal();
    void refresh();
  };
  document.querySelectorAll('[data-share-open]').forEach((b) => b.addEventListener('click', open));
  sheet.querySelector('[data-share-close]')?.addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });
  sheet.querySelectorAll<HTMLButtonElement>('[data-share-format]').forEach((b) =>
    b.addEventListener('click', () => {
      format = b.dataset.shareFormat === 'status' ? 'status' : 'post';
      sheet.querySelectorAll('[data-share-format]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      void refresh();
    }),
  );
  sheet.querySelectorAll<HTMLButtonElement>('[data-share-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      lang = b.dataset.shareLang === 'hi' ? 'hi' : 'en';
      sheet.querySelectorAll('[data-share-lang]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      void refresh();
    }),
  );
  sheet.querySelector('[data-share-image]')?.addEventListener('click', async () => {
    if (!blob) await refresh();
    const file = new File([blob!], fileName(), { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: card[lang].text });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
    // No file sharing here (most desktops): download instead.
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
  });
  sheet.querySelector('[data-share-download]')?.addEventListener('click', async () => {
    if (!blob) await refresh();
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
  });
  const copyBtn = sheet.querySelector<HTMLButtonElement>('[data-share-copy]');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(card.url);
      const old = copyBtn.textContent;
      copyBtn.textContent = `✓ ${copyBtn.dataset.copied}`;
      setTimeout(() => (copyBtn.textContent = old), 1600);
    } catch {
      prompt('', card.url);
    }
  });
}

export {};
