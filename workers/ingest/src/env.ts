export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ARCHIVE: R2Bucket;
  /** Bearer token for POST /ingest and /run/* (secret). */
  INGEST_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  CONTACT_EMAIL?: string;
  /** Free plan: lets the watchdog cron dispatch the GitHub ingest workflow (secret; watchdog.ts). */
  GITHUB_DISPATCH_TOKEN?: string;
  /** "owner/repo" holding the ingest workflow (var). */
  GITHUB_REPO?: string;
  /** The workflow file to dispatch (var); default ingest.yml. */
  GITHUB_WORKFLOW?: string;
}

/** KV key the website reads. Bump the version when the Bundle shape changes. */
export const BUNDLE_KEY = 'bundle:v1';
export const STATUS_KEY = 'ingest:status';
/** Per-city correction for the modelled estimate (scripts/calibrate.ts). */
export const CALIBRATION_KEY = 'cams:calibration';
/** 30 days of CPCB's official daily AQI for every city (the home map replay). */
export const REPLAY_KEY = 'replay:30d';
/** The world estimate: every covered city outside India, 24 h back and 48 h ahead (scripts/ingest-run.ts global). */
export const GLOBAL_KEY = 'global:v1';

export function userAgent(env: Env): string {
  return `SaansAQI/1.0 (air-quality archive; contact ${env.CONTACT_EMAIL ?? 'unknown'})`;
}
