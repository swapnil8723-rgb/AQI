# Saans — India's transparent air-quality site

Live AQI for Indian cities from CPCB's own stations, with three numbers kept
apart on every city page: **CPCB's official 4 PM bulletin**, **our hourly live
estimate** (CPCB's method, reproduced), and **every station**. English at `/`,
Hindi at `/hi/`. Plan: [PLAN.md](PLAN.md) · design: [DESIGN.md](DESIGN.md) ·
agent rules: [AGENTS.md](AGENTS.md).

"Saans" is a working name — change it in `apps/web/src/lib/site.ts`,
`apps/web/public/` and the Hindi dictionary before launch.

## Repository

```
packages/aqi        NAQI + US EPA engine (pure TS, 183 tests with the pipeline)
packages/data       launch cities (EN/HI), aliases, CPCB health text, GRAP, station names
packages/pipeline   feed parsing, abnormal-value flags, station/city AQI, bulletin PDF parser, bundle
workers/ingest      Cloudflare cron Worker: hourly feed → D1/KV/R2, 4 PM bulletin, nightly archive
apps/web            Astro 7 + Tailwind 4 site on Workers (SSR, edge-cached 10 min)
scripts/            gate (bulletin reproduction), backfill, fixture, map build, smoke, push
```

Data flow: `data.gov.in → saans-ingest → KV "bundle:v1" → saans-web`. The site
only reads one KV value per render (memoised per isolate), so it keeps working
if D1 or the ingest Worker has a bad hour.

## Commands

```bash
npm install
npm test                 # engine + pipeline tests
npm run check            # types: packages, worker, site (astro check)
npm run gate -- 2026-09-20 2026-09-23   # reproduce CPCB's bulletin from the feed at 4 PM
npm run fixture -- 2026-09-25 --shift-to-now   # real-data dev bundle (needs npm run backfill first)
npm run seed             # load the fixture into the site's local KV
npm run dev              # site on http://127.0.0.1:4321 (runs on workerd, like production)
npm run smoke            # every route, redirects, "Official" wording, JSON endpoints
npm run map              # rebuild india-map.json / city-maps.json from DataMeet shapefiles
node scripts/build-replay.ts   # static replays (public/replay/diwali-2025.json) from the bulletin backfill
```

`npm run fixture` replays real archived CPCB data as *today*: it picks the
archived snapshot whose IST time of day is closest to now and moves the whole
day (readings, hourly history, bulletins) by whole days, so every date on the
page stays coherent. Re-run it and `npm run seed` when the preview says stale.

## Features beyond the plan (round 2, 27 Sep 2026)

- **Zoom and pan on both maps** (`scripts/zoom.ts`, ~3 KB): + − reset, double-tap,
  Ctrl/⌘ + scroll or trackpad pinch (plain scroll still scrolls the page), two-finger
  pinch, drag once zoomed, keyboard. Dots keep their screen size, so zooming separates them.
- **Semantic zoom on the India map**: past 2.5× every CPCB station (~490) appears;
  past 5× each pin shows its AQI. Deep links: `/#map=8/19.99/73.79`.
- **"Watch the air move"**: replay CPCB's official daily AQI for every city —
  the last 30 days (KV `replay:30d`, rebuilt by the 4 PM bulletin job) or Diwali 2025
  (static file). 21 Oct 2025: the Indo-Gangetic plain turns red; worst city Jind, 421.
- **Search that finds stations and areas** ("Anand Vihar" → its row on the Delhi page)
  and every other CPCB city (→ the map, zoomed there), plus recent and popular cities.
- **Share sheet**: image card previewed on the phone, Post 4:5 or WhatsApp Status 9:16,
  English or Hindi, with 24-hour bars, the official CPCB value and (Status) last year.
- **Same day last year** (official CPCB value) on every city page, from the backfill.

## What we verified (26–27 Sep 2026)

| Question (PLAN.md §3.2) | Finding |
|---|---|
| What is the feed's value? | `avg_value` is CPCB's **sub-index**, not a concentration (fields are `min_value/max_value/avg_value`; min/max = 24-h hourly range). Concentrations are recovered by inverting the NAQI table. |
| Can we reproduce CPCB? | Yes. Station AQI = max sub-index (≥ 3 pollutants incl. PM); city = mean of stations; the feed's `city` field is CPCB's own grouping. With the feed as it stood at 16:00 IST on 20 and 23 Sep: **97% of 478 city-days within ±10% of the bulletin, 85% identical, 49/50 launch city-days within ±10%.** |
| Where is the bulletin? | A **PDF**, not an HTML table: `cpcb.gov.in/upload/Downloads/AQI_Bulletin_YYYYMMDD.pdf`, online back to 2015 in three layouts — all parsed. |
| Abnormal readings | Calibrated on 3,279 real rows: flat traces at Moderate+ (e.g. a stuck CO sensor at 147–148 all day), spikes the city doesn't share, PM2.5 > PM10 (seen 0/386), negatives. Flagged, never deleted. |
| Worker end to end | On workerd locally: 3,279 real rows → 503 stations, D1, R2 raw archive, KV bundle; the bulletin job fetched and parsed CPCB's real PDF inside the Worker and reconciled 25/25 launch cities within ±10% (21 identical). |

## Deploy

Step-by-step for **Cloudflare** (recommended, US$5/month) or **Vercel** (site)
with Cloudflare (data): see [DEPLOY.md](DEPLOY.md). Run locally first:
`npm install`, `npm run backfill -- 2025-09-01 2026-09-26` (once), `npm run dev:fresh`.

## Operations

- **Health**: `GET https://saans-ingest.<you>.workers.dev/health` — 503 when the
  bundle is over 2 h old or two hourly runs failed. Telegram alerts on the
  second consecutive failure, on recovery, and when a launch city's 4 PM
  estimate differs from CPCB's bulletin by more than 10%.
- **GRAP**: edit `GRAP_STATUS` in `packages/data/src/grap.ts` from the CAQM
  order, redeploy the site. The section stays hidden while it is `null`.
- **Add a city**: add it to `packages/data/src/cities.ts` (feed spelling from
  `/api/stations.json`, bulletin spelling from the PDF), run `npm run map`,
  check it with `npm run gate`, then set `live: true`.
- **Ads / analytics**: set `ADSENSE_CLIENT` / `CF_BEACON_TOKEN` in
  `apps/web/wrangler.jsonc` vars. Ad slots render nothing until then.

## Credits

CPCB data (GODL-India) · DataMeet boundaries (CC BY 4.0) · india-geodata
archive used for validation (CC BY 4.0) · Geist and Noto Sans Devanagari (OFL)
· Lucide icons (ISC).
