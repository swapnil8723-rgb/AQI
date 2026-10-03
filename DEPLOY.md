# Deploy Saans

Two parts, always:

1. **saans-ingest** (Cloudflare Worker) — fetches CPCB every hour, keeps the
   archive (D1 + R2), reads the 4 PM bulletin, publishes the data. It must run
   on Cloudflare: it needs hourly cron (Vercel Hobby only allows daily).
2. **saans-web** (the website) — on **Cloudflare** (Option A, recommended) or
   **Vercel** (Option B). Same code; the build picks the host automatically.

| | A · All Cloudflare | B · Vercel site + Cloudflare data |
|---|---|---|
| Monthly cost | **US$5** (Workers Paid, covers both) | US$5 Cloudflare + Vercel (Hobby is free but **non-commercial** — ads need Pro, US$20) |
| Speed in India | Cloudflare edge in Mumbai, Delhi, Chennai… | Vercel edge, cached 10 min |
| Setup | One account | Two accounts |

---

## Free plan (current setup)

On Workers **Free**, the Worker cannot do the hourly work itself (10 ms CPU per
request, 5 cron triggers per account). So:

- **GitHub Actions** (`.github/workflows/ingest.yml`) runs every hour at :20 UTC:
  fetches CPCB, computes everything, parses the 4 PM bulletin (17:00–21:00 IST),
  writes yesterday's archive (00:xx IST). GitHub emails you if a run fails.
- **The Worker** (`aqi`) only stores what Actions sends (`/store`, `/read`) and
  serves `/health` and `/v1/*.json`. It has no cron triggers.

Setup:
1. Worker **aqi → Settings → Variables and Secrets**: add secret `INGEST_TOKEN` (a long password).
2. GitHub repo **AQI → Settings → Secrets and variables → Actions**:
   - *Secrets*: `INGEST_TOKEN` (the same password). No data source key is
     needed — CPCB's feed is gone and the CAMS estimate is keyless.
   - *Variables*: `INGEST_URL` = `https://aqi.swapnil-8723.workers.dev`
3. GitHub → **Actions → ingest → Run workflow** (job `auto`) to start now; then it runs every hour.
4. Check `https://aqi.swapnil-8723.workers.dev/health` → `"healthy": true`.

Private repos get 2,000 free Actions minutes a month; this uses about 1,000.
**Moving to Workers Paid later:** restore the crons in `workers/ingest/wrangler.jsonc`
(the line is in the comment), push, and disable the workflow
(Actions → ingest → ⋯ → Disable workflow). Note the Worker's own hourly job
covers the 25 launch cities only; the Actions job also scores the ~280 map
cities, so keep this workflow if you want the national map to stay live.

## 0. Run it on your computer

```bash
npm install
```
```bash
npm run backfill -- 2025-09-01 2026-09-26
```
(once, about 7 minutes — downloads CPCB's official bulletins)
```bash
npm run dev:fresh
```
Open http://127.0.0.1:4321. `dev:fresh` replays real archived CPCB data as
"today", loads it and starts the site. When the page says data is stale, stop
it (Ctrl+C) and run `npm run dev:fresh` again.

---

## 1. Before you start (both options)

- **No data source key.** CPCB's data.gov.in feed stopped answering in Sep 2026; the hourly estimate comes from Open-Meteo's CAMS endpoint, which needs no key, and the daily bulletin is a public PDF. After the first bulletins are stored, run `npm run calibrate` once so the estimate is corrected per city (until then it reads ~2x high and the hourly job warns).
- **Before you switch ads on, pay Open-Meteo.** We use ~24 calls a day against a 10,000/day allowance, so volume is not the issue — but their free tier is non-commercial and its terms name sites that display advertisements as needing a paid plan. Take a paid plan or self-host their API first. The data itself is CC BY 4.0 and is attributed in the footer.
- **Cloudflare account** with **Workers Paid** (dashboard → Workers & Pages → *Plans* → Paid, US$5/month). The free plan's 10 ms CPU limit is too small to parse CPCB's feed and the bulletin PDF.
- **R2 enabled** (dashboard → R2 → *Purchase R2 / Enable*; the free 10 GB is enough).
- A **domain** (optional to start — you can use the `*.workers.dev` / `*.vercel.app` address first).
- Optional: a **Telegram bot** for alerts (talk to @BotFather → token; send your bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat id).

All commands below run in a terminal at the repo root unless a step says `cd`.

---

## 2. The data Worker (both options)

```bash
npx wrangler login
```
```bash
cd workers/ingest
```
Create the database, the key-value store and the archive bucket:
```bash
npx wrangler d1 create saans
```
```bash
npx wrangler kv namespace create KV
```
```bash
npx wrangler r2 bucket create saans-archive
```
Paste the printed ids:
- `database_id` → `workers/ingest/wrangler.jsonc` (replace `REPLACE_WITH_D1_DATABASE_ID`)
- KV `id` → `workers/ingest/wrangler.jsonc` **and** `apps/web/wrangler.jsonc` (replace `REPLACE_WITH_KV_NAMESPACE_ID`)

Secrets (each command asks you to paste the value):
```bash
npx wrangler secret put INGEST_TOKEN
```
(`INGEST_TOKEN` = any long random password; you use it for manual runs.)
Optional alerts:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

Create the tables, then load 13 months of official history:
```bash
npx wrangler d1 migrations apply saans --remote
```
```bash
npx wrangler d1 execute saans --remote --file=../../.cache/backfill/bulletins.sql
```
(Run step 0's `npm run backfill` first. To go back further, run it with an older start date — every year back to 2015 is online.)

Deploy and start the archive **today** — every hour not captured is lost:
```bash
npx wrangler deploy
```
It prints the Worker's address, e.g. `https://saans-ingest.<you>.workers.dev`. Trigger the first run and the first replay:
```bash
curl -X POST -H "Authorization: Bearer YOUR_INGEST_TOKEN" https://saans-ingest.<you>.workers.dev/run/hourly
```
```bash
curl -X POST -H "Authorization: Bearer YOUR_INGEST_TOKEN" "https://saans-ingest.<you>.workers.dev/run/bulletin?date=2026-09-26"
```
Check it: open `https://saans-ingest.<you>.workers.dev/health` — `"healthy": true`.
From now on it runs by itself: every hour at :20, the bulletin from 17:15 IST, the archive at 00:30 IST.

---

## 3A. Website on Cloudflare (recommended)

```bash
cd ../../apps/web
```
Mac/Linux:
```bash
SITE_URL=https://your-domain.in npm run deploy
```
Windows PowerShell:
```powershell
$env:SITE_URL="https://your-domain.in"; npm run deploy
```
(Until you have a domain, use the address it prints, e.g. `https://saans-web.<you>.workers.dev`, as `SITE_URL` and deploy again.)

**Domain:** dashboard → Workers & Pages → *saans-web* → Settings → *Domains & Routes* → *Add* → Custom domain. The domain's DNS must be on Cloudflare.

**Auto-deploy from GitHub (optional):** Workers & Pages → *saans-web* → Settings → *Build* → connect the repo; root directory `apps/web`; build command `npm run build:prod`; deploy command `npx wrangler deploy`; add the build variable `SITE_URL`.

---

## 3B. Website on Vercel

1. Push the repo to GitHub.
2. vercel.com → *Add New… → Project* → import the repo.
3. **Root Directory:** `apps/web` (Framework: Astro is detected; the build command comes from `apps/web/vercel.json`).
4. **Environment Variables:**
   - `SITE_URL` = `https://your-domain.in` (or your `*.vercel.app` address to start)
   - `SAANS_DATA_URL` = `https://saans-ingest.<you>.workers.dev` (the Worker from step 2)
   - optional `ADSENSE_CLIENT`, `CF_BEACON_TOKEN`
5. *Deploy*. The build sees `VERCEL=1` and switches to the Vercel adapter; pages read the Worker's `/v1/bundle.json`, and Vercel's CDN caches each page for 10 minutes.
6. **Domain:** project → Settings → *Domains* → add it and follow the DNS instructions.

---

## 4. After launch (both options)

- **Search Console:** add the domain → submit `https://your-domain.in/sitemap.xml`.
  - **On the temporary `*.workers.dev` / `*.vercel.app` address** a Domain
    property is impossible (no DNS to edit). Add a **URL prefix** property for
    the exact address, pick **HTML tag**, and put only the `content="…"` value
    in `GOOGLE_SITE_VERIFICATION` (`apps/web/wrangler.jsonc` vars, or a Vercel
    environment variable), redeploy, then press Verify. Keep the value set —
    removing it un-verifies the property.
  - Submit the sitemap only once `/health` says `"healthy": true`: city pages
    are `noindex` until they have had data in the last 72 hours.
  - **When you buy a domain later:** add it to the Worker, redeploy with
    `SITE_URL` set to it, verify it as a Domain property, 301-redirect the old
    address to it, then use Search Console's *Change of address* tool on the
    old property.
- **Watch it:** `/health` on the Worker (503 = data older than 2 h, or 2 failed runs). Telegram alerts arrive on the second failed run and whenever a city's 4 PM estimate differs from CPCB's bulletin by more than 10%.
- **GRAP:** when CAQM issues an order, edit `packages/data/src/grap.ts` and redeploy the site.
- **If the estimate drifts from the bulletin:** run `npm run calibrate` (it runs daily at 22:15 IST anyway). It relearns each city's correction from the stored bulletins; a city needs 3 bulletin days before it gets its own factor.
- **If CPCB's feed ever returns:** `packages/pipeline/src/feed.ts` and the station path are intact — point `hourly()` back at them, drop `live: 'cams'`, and the station map, station pages and `npm run gate` come back as they were.
- **Ads / analytics:** set `ADSENSE_CLIENT` / `CF_BEACON_TOKEN` (Cloudflare: `apps/web/wrangler.jsonc` vars; Vercel: environment variables). Ad slots stay empty until then.
