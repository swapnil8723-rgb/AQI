/**
 * saans-ingest: hourly CAMS estimate → archive, daily CPCB bulletin reconciliation,
 * nightly archive dump. See PLAN.md §3 and README.md.
 *
 * HTTP (all JSON):
 *   GET  /health                 public: last run of each job, bundle age
 *   GET  /v1/bundle.json         public: the hourly bundle (for a site hosted off Cloudflare, e.g. Vercel)
 *   GET  /v1/replay.json         public: 30 days of official daily AQI (home map replay)
 *   GET  /v1/global.json         public: the world estimate (every covered city outside India)
 *   POST /ingest                 retired (410): CPCB stopped publishing the feed in Sep 2026
 *   POST /run/hourly             Bearer; run the hourly job now
 *   POST /run/bulletin?date=     Bearer; fetch and reconcile a bulletin (default: today IST)
 *   POST /run/archive?date=      Bearer; dump a day to R2 (default: yesterday IST)
 *   /store/*, /read/*            Bearer; storage gateway for GitHub Actions on the Free plan (store.ts)
 */

import { addDays, istDate } from '@saans/pipeline';
import { readStatus, record, type Job } from './alert.ts';
import { archiveDay } from './archive.ts';
import { bulletinJob } from './bulletin.ts';
import { BUNDLE_KEY, GLOBAL_KEY, REPLAY_KEY, type Env } from './env.ts';
import { hourly } from './hourly.ts';
import { store } from './store.ts';
import { watchdog } from './watchdog.ts';

async function run(env: Env, job: Job, fn: () => Promise<unknown>): Promise<unknown> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const out = await fn();
    const o = (out ?? {}) as { rows?: number; stations?: number };
    await record(env, job, { at, ok: true, ms: Date.now() - started, message: JSON.stringify(out).slice(0, 400), rows: o.rows, stations: o.stations });
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${job} failed`, message);
    await record(env, job, { at, ok: false, ms: Date.now() - started, message });
    throw e;
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function authorised(req: Request, env: Env): boolean {
  if (!env.INGEST_TOKEN) return false;
  const h = req.headers.get('authorization') ?? '';
  const a = new TextEncoder().encode(h);
  const b = new TextEncoder().encode(`Bearer ${env.INGEST_TOKEN}`);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    switch (controller.cron) {
      case '20 * * * *':
        await run(env, 'hourly', () => hourly(env));
        break;
      case '45 11-15 * * *': {
        const final = new Date(now).getUTCHours() >= 15;
        await run(env, 'bulletin', () => bulletinJob(env, istDate(now), final));
        break;
      }
      case '0 19 * * *':
        // 19:00 UTC is 00:30 IST: dump the IST day that just ended.
        await run(env, 'archive', () => archiveDay(env, addDays(istDate(now), -1)));
        break;
      case '50 * * * *':
        // Free plan: re-dispatch the GitHub workflow when its schedule skipped an hour.
        await watchdog(env, now);
        break;
      default:
        console.warn('unknown cron', controller.cron);
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Read-only data for a website hosted elsewhere (Vercel): the same values the
    // Cloudflare site reads from KV. Cached at the edge for 5 minutes.
    const PUBLIC: Record<string, string> = { '/v1/bundle.json': BUNDLE_KEY, '/v1/replay.json': REPLAY_KEY, '/v1/global.json': GLOBAL_KEY };
    if (req.method === 'GET' && PUBLIC[url.pathname]) {
      const key = PUBLIC[url.pathname]!;
      // A stream, so the bytes pass through without being decoded (Free plan CPU).
      const body = await env.KV.get(key, { type: 'stream', cacheTtl: 60 });
      if (!body) return json({ error: 'not ready' }, 503);
      return new Response(body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300, s-maxage=300',
          'access-control-allow-origin': '*',
        },
      });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      // Status only (a few hundred bytes): parsing the 160 KB bundle would cost CPU on the Free plan.
      const status = await readStatus(env);
      const age = status.lastGood ? Math.round((Date.now() - Date.parse(status.lastGood)) / 60000) : null;
      const healthy = age !== null && age < 120 && status.failures < 2;
      return json({ healthy, minutesSinceLastGoodRun: age, ...status }, healthy ? 200 : 503);
    }
    if (url.pathname.startsWith('/store/') || url.pathname.startsWith('/read/')) {
      if (!authorised(req, env)) return json({ error: 'unauthorised' }, 401);
      return (await store(req, env, url)) ?? json({ error: 'not found' }, 404);
    }
    if (req.method !== 'POST') return json({ error: 'not found' }, 404);
    if (!authorised(req, env)) return json({ error: 'unauthorised' }, 401);

    const date = url.searchParams.get('date');
    if (date && !DATE.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
    try {
      switch (url.pathname) {
        // Retired with the feed it carried: /ingest accepted data.gov.in rows
        // pushed from elsewhere, for the case where CPCB blocked Cloudflare's
        // IPs. CPCB stopped publishing the feed entirely in Sep 2026, so there
        // is nothing to push. The hourly estimate needs no key — use /run/hourly.
        case '/ingest':
          return json({ error: 'retired: CPCB stopped publishing the feed in Sep 2026; use POST /run/hourly' }, 410);
        case '/run/hourly':
          return json(await run(env, 'hourly', () => hourly(env)));
        case '/run/bulletin':
          return json(await run(env, 'bulletin', () => bulletinJob(env, date ?? istDate(Date.now()), false)));
        case '/run/archive':
          return json(await run(env, 'archive', () => archiveDay(env, date ?? addDays(istDate(Date.now()), -1))));
        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
