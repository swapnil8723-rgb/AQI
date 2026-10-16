/**
 * Watchdog for the Free-plan setup, where GitHub Actions does the hourly work.
 *
 * GitHub's `schedule:` trigger is best-effort: on 8–9 Oct 2026 only 4 of 24
 * hourly runs fired, so the site went hours without an update. Cloudflare's
 * cron does fire, but a Free Worker cannot do the work itself (10 ms CPU). It
 * can ask GitHub to: at :50 each hour, if no good run landed in the last 40
 * minutes, it dispatches the workflow. When the schedule did fire, this is one
 * KV read and nothing else, so it never doubles the Actions minutes.
 *
 * Needs GITHUB_DISPATCH_TOKEN (secret): a fine-grained token for this repo
 * only, with "Actions: Read and write". Without it the cron logs and returns.
 */
import { readStatus } from './alert.ts';
import type { Env } from './env.ts';

/** A run younger than this means the scheduled run fired this hour. */
const FRESH_MS = 40 * 60_000;

export async function watchdog(env: Env, now = Date.now()): Promise<string> {
  const status = await readStatus(env);
  const last = status.lastGood ? Date.parse(status.lastGood) : 0;
  if (now - last < FRESH_MS) return 'fresh';
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPO) {
    console.warn('watchdog: last good run is stale, but GITHUB_DISPATCH_TOKEN / GITHUB_REPO are not set');
    return 'no-token';
  }
  const workflow = env.GITHUB_WORKFLOW || 'ingest.yml';
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'saans-ingest-watchdog',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { job: 'auto' } }),
  });
  if (res.status !== 204) {
    const text = await res.text();
    throw new Error(`watchdog: dispatch failed, HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log(`watchdog: dispatched ingest (last good run ${status.lastGood ?? 'never'})`);
  return 'dispatched';
}
