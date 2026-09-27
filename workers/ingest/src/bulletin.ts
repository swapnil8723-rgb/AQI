import { CITIES } from '@saans/data';
import {
  bulletinCityKey,
  bulletinUrl,
  istAt,
  parseBulletinText,
  slugForBulletinCity,
  type Bundle,
} from '@saans/pipeline';
import { extractText, getDocumentProxy } from 'unpdf';
import { telegram } from './alert.ts';
import { accuracy, bulletinDays, latestBulletins } from './db.ts';
import { BUNDLE_KEY, userAgent, type Env } from './env.ts';

export const RECONCILE_TOLERANCE = 0.1;

export async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export interface BulletinResult {
  status: 'stored' | 'already-stored' | 'not-published';
  cities?: number;
  reconciled?: { slug: string; ours: number; cpcb: number; delta: number }[];
}

/**
 * The 4 PM bulletin job (17:15 IST, retried hourly until 21:15). Stores every
 * city CPCB lists, records our own 16:00 estimate beside each launch city,
 * alerts when they differ by more than 10%, and patches the live bundle so
 * the "Official CPCB bulletin" line updates without waiting an hour.
 */
export async function bulletinJob(env: Env, date: string, final: boolean): Promise<BulletinResult> {
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM bulletin WHERE date = ?').bind(date).first<number>('n');
  if (have && have > 50) return { status: 'already-stored' };

  const url = bulletinUrl(date);
  const res = await fetch(url, { headers: { 'user-agent': userAgent(env) }, redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('pdf')) {
    if (final) throw new Error(`bulletin for ${date} not published by 21:15 IST (HTTP ${res.status}, ${type})`);
    return { status: 'not-published' };
  }
  const bulletin = parseBulletinText(await pdfText(await res.arrayBuffer()), url);
  if (!bulletin || bulletin.date !== date || bulletin.rows.length < 50) {
    throw new Error(`bulletin ${date}: parsed ${bulletin?.rows.length ?? 0} rows for ${bulletin?.date ?? 'no date'} — layout changed?`);
  }

  const { results: ours } = await env.DB.prepare('SELECT city_slug, aqi FROM city_hour WHERE hour = ?')
    .bind(istAt(date, 16))
    .all<{ city_slug: string; aqi: number }>();
  const oursBySlug = new Map(ours.map((r) => [r.city_slug, r.aqi]));

  const stmts = bulletin.rows.map((r) => {
    const slug = slugForBulletinCity(r.city);
    return env.DB.prepare(
      `INSERT OR REPLACE INTO bulletin (city_key, date, city, city_slug, aqi, category, prominent, used, total, ours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(bulletinCityKey(r.city), date, r.city, slug, r.aqi, r.category, r.prominent.join(','), r.used, r.total, slug ? (oursBySlug.get(slug) ?? null) : null);
  });
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));

  // Reconciliation (PLAN.md §6): our 16:00 estimate vs CPCB's published value.
  const reconciled: NonNullable<BulletinResult['reconciled']> = [];
  for (const r of bulletin.rows) {
    const slug = slugForBulletinCity(r.city);
    const mine = slug ? oursBySlug.get(slug) : undefined;
    if (!slug || mine === undefined) continue;
    reconciled.push({ slug, ours: mine, cpcb: r.aqi, delta: (mine - r.aqi) / r.aqi });
  }
  const off = reconciled.filter((x) => Math.abs(x.delta) > RECONCILE_TOLERANCE);
  if (off.length) {
    await telegram(
      env,
      `Saans reconciliation ${date}: ${off.length}/${reconciled.length} launch cities off by >10%\n` +
        off.map((x) => `${x.slug}: ours ${x.ours} vs CPCB ${x.cpcb} (${(x.delta * 100).toFixed(0)}%)`).join('\n'),
    );
  }

  // Patch the live bundle's bulletin line and 30-day strip right away.
  const bundle = await env.KV.get<Bundle>(BUNDLE_KEY, 'json');
  if (bundle) {
    const [latest, days, acc] = await Promise.all([latestBulletins(env.DB, bulletinUrl), bulletinDays(env.DB, date), accuracy(env.DB)]);
    bundle.accuracy = acc;
    for (const c of CITIES) {
      const cb = bundle.cities[c.slug];
      if (!cb) continue;
      cb.bulletin = latest[c.slug] ?? cb.bulletin;
      cb.days = days[c.slug] ?? cb.days;
    }
    await env.KV.put(BUNDLE_KEY, JSON.stringify(bundle));
  }
  return { status: 'stored', cities: bulletin.rows.length, reconciled };
}
