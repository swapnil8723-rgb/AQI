import type { Env } from './env.ts';
import { STATUS_KEY } from './env.ts';

export type Job = 'hourly' | 'bulletin' | 'archive';

export interface JobStatus {
  at: string;
  ok: boolean;
  ms: number;
  message: string;
  rows?: number;
  stations?: number;
}

export interface Status {
  hourly?: JobStatus;
  bulletin?: JobStatus;
  archive?: JobStatus;
  /** Consecutive hourly failures. */
  failures: number;
  /** Last successful hourly run. */
  lastGood?: string;
}

export async function readStatus(env: Env): Promise<Status> {
  return (await env.KV.get<Status>(STATUS_KEY, 'json')) ?? { failures: 0 };
}

export async function telegram(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn('alert (no Telegram configured):', text);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('telegram failed', e);
  }
}

/**
 * Record a run in KV and D1, and alert on the second consecutive hourly
 * failure (PLAN.md §7: "you'll know before users do") and on recovery.
 */
export async function record(env: Env, job: Job, s: JobStatus): Promise<void> {
  const status = await readStatus(env);
  status[job] = s;
  if (job === 'hourly') {
    if (s.ok) {
      if (status.failures >= 2) await telegram(env, `Saans ingest recovered after ${status.failures} failed runs.`);
      status.failures = 0;
      status.lastGood = s.at;
    } else {
      status.failures++;
      if (status.failures === 2 || status.failures % 6 === 0) {
        await telegram(env, `Saans ingest failed ${status.failures}× in a row. Last good: ${status.lastGood ?? 'never'}.\n${s.message}`);
      }
    }
  } else if (!s.ok) {
    await telegram(env, `Saans ${job} job failed: ${s.message}`);
  }
  await env.KV.put(STATUS_KEY, JSON.stringify(status));
  await env.DB.prepare('INSERT INTO runs (job, started, ms, ok, rows, stations, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(job, s.at, s.ms, s.ok ? 1 : 0, s.rows ?? null, s.stations ?? null, s.message.slice(0, 500))
    .run()
    .catch((e: unknown) => console.error('runs insert failed', e));
}
