# PLAN.md — India AQI + Weather Site

> Working name: **Saans** (साँस, "breath"). Replace before launch. Check domain availability yourself (e.g. `saans.in`, `saansaqi.com`, `saans.live`); nothing here assumes one is free.
> Stack: **Astro** (latest stable) · **Tailwind CSS v4** · **Cloudflare Workers + D1 + KV + R2** · Vercel-style visual system (see `DESIGN.md`).
> Plan date: 26 Sep 2026 (v3, revised after external review; see §15). Soft launch **10 Oct** (10 cities), public launch **25 Oct** (≤ 25 cities), ahead of Diwali on 8 Nov 2026.

---

## 0. One-paragraph strategy

Don't clone aqi.in. Build **India's most transparent local air-quality page: fast, Hindi-first, and showing exactly where every number comes from**. Then grow into Indian-language city weather.

Positioning line: **"See exactly where the number comes from." / "जानिए यह नंबर कहाँ से आया।"**

Every city page separates three things that other sites blur together:
1. **Official:** CPCB's own daily city AQI (the 4 PM bulletin, the number Indian news quotes), shown as published and never recomputed.
2. **Live estimate:** Saans's hourly city number, computed from valid CPCB stations with CPCB's method and clearly labelled as ours.
3. **Stations:** every station's own AQI, with the range.

The US EPA scale is a comparison toggle, and a plain-language "what should I do today" card uses CPCB category guidance.

**Where the effort goes:** about 70% on data pipeline, validation, archive, SEO and trust, and about 30% on UI. The map, gauge, weather, dark mode and city pages are easy for competitors to copy. An **hourly station-level archive started on day one**, plus a published, reproducible methodology, is not.

**Competitors are strong and already feature-rich.** aqi.in already has alerts, weather, maps, history and widgets, and IQAir has forecasts, maps and recommendations. So features alone won't differentiate. The wedge is transparency, speed on cheap phones, Hindi, and the archive.

---

## 1. Goals and non-goals

**Season 1 goals (Oct 2026 – Jan 2027)**
| Goal | Target |
|---|---|
| Archiver running without gaps | ≥ 98% of hours captured from 27 Sep 2026 |
| Data correctness (launch gate) | Live estimate at 4 PM within ±10% of CPCB's bulletin for ≥ 90% of launch cities, 7 days running |
| Indexed city pages (EN + HI) | 10 by 10 Oct, 20–25 by Diwali. Beyond that, **Search Console decides**: add cities in batches of 25 only when existing pages earn impressions |
| Organic + social visits | 50K/month at the Nov peak (stretch: 150K) |
| Share rate | shares ÷ sessions ≥ 2% on city pages (absolute shares/day is a stretch metric only) |
| Core Web Vitals (mobile, 4G) | LCP < 1.8 s, CLS < 0.05, INP < 150 ms |
| Revenue | AdSense approved + first 3 Amazon Associates sales (keeps the account alive) |

**Non-goals for Season 1:** own sensors, mobile app, global coverage, a user-accounts system, the weather section (Season 2), and AI-written city blurbs.

---

## 2. Hosting decision (important)

**Use the Vercel *design language*, not Vercel *hosting*.** The Vercel Hobby plan is for personal, non-commercial use only, so an ad-monetised site would need Pro. Cloudflare's free tier allows commercial use and has everything needed here:

| Need | Cloudflare piece | Free tier covers Season 1? |
|---|---|---|
| Astro SSR pages | Workers (`@astrojs/cloudflare`) | Yes. The limit is 100K **Worker invocations**/day, not visits (see note below) |
| JS, CSS, fonts, images, share-card cache | Workers static assets | Yes: static-asset requests are free, unlimited and don't count toward the limit |
| Map tiles (PMTiles) | R2 **public bucket on a custom subdomain** (e.g. `tiles.saans.in`) | Yes; tiles never go through a Worker, so a map session can't burn the request quota |
| Hourly data ingest | Separate Worker with a Cron Trigger | Yes |
| Hourly readings DB | D1 (SQLite) | Yes (5 GB) |
| "Latest per city" snapshot | KV | Yes |
| Daily archive dumps | R2 | Yes (10 GB) |
| HTML caching | Cache API, `s-maxage=600, stale-while-revalidate=1800` | Yes |

**Quota maths.** A typical visit costs about 2–3 Worker invocations: the HTML page, `/api/here` on home, and `/api/stations/{city}.geojson` if the map opens. Assets and tiles are free. So the free tier holds roughly **30–50K visits/day**, far above the Season 1 target. Move to Workers Paid ($5/mo, 10M requests/month included) when the daily invocation graph passes about 70K/day. It's a quota line, not a traffic milestone. Keep an eye on D1 too: the free tier allows 100K rows written/day, and ingest writes about 500 stations × 7 pollutants ≈ 3,500 rows/hour ≈ 84K/day. **That's close to the cap**, so batch writes and store one row per station-hour with pollutants as columns (≈ 12K rows/day). The schema below does this.

*Alternative:* your own VPS with the Astro Node adapter, Postgres, a system cron job and an Nginx micro-cache. That works, but you then own the uptime during the one season that matters.

---

## 3. Data architecture

```
data.gov.in (CPCB real-time AQI API)
        │  hourly cron at :20 (CPCB refreshes ~hourly)
        ▼
workers/ingest ──► validate ─► normalise ─► D1: readings (station, pollutant, hour, value)
        │                                   │
        │                                   ├─► compute NAQI per station (packages/aqi)
        │                                   ├─► roll up city snapshot ─► KV: city:{slug}:latest
        │                                   └─► 00:30 IST daily ─► R2: archive/YYYY/MM/DD.csv.gz
        │
CPCB daily AQI bulletin (cpcb.nic.in, 4 PM, 24-h avg)
        │  daily cron at 17:15 IST (retry hourly until 21:00)
        ▼
workers/ingest ──► parse table ─► D1: bulletin (city, date, aqi, pollutants, stations_used/total)
        │                       └─► reconcile: our 4 PM live estimate vs bulletin ─► alert if |Δ| > 10%
        ▼
apps/web (Astro SSR) reads KV (fast path) + D1 (charts/history) ─► edge cache 10 min
```

### 3.1 Sources (CPCB only in Season 1)

> **Amendment, 30 Sep 2026 — the hourly station feed is gone.**
> data.gov.in refuses connections (502/504, then no connection at all; its own
> catalog endpoint and its own resource page fail too). CPCB's legacy JSON
> endpoints answer 404 and the replacement Central Control Room app is an
> obfuscated SPA behind OAuth. Every free redistributor went down with it:
> WAQI's Indian stations last reported 2026-06-23, and OpenAQ carries no
> Indian locations. This is also why aqi.in looks unaffected — they are not
> downstream of CPCB at all, they own the sensors.
>
> **The daily bulletin is unaffected** and remains the official figure. The
> hourly estimate in between is now **CAMS via Open-Meteo**, scored with
> CPCB's own windows and sub-index and corrected per city against recent
> bulletins (`packages/pipeline/src/cams.ts`). It is labelled as modelled
> everywhere it appears, and it has no stations — so station pages, the
> station map and the station-range row are dormant.
>
> **The accuracy claim below no longer holds while the number is modelled.**
> Uncorrected CAMS matched 0% of launch cities within ±10% of the 29 Sep
> bulletin; corrected, about 44% within 10% and 96% within 50%. `/about` must
> publish that band, not the station-era figure. Restore the old claim only
> if a real station feed returns.

- **Hourly station data (retired):** CPCB via data.gov.in, the "Real time Air Quality Index from various locations" dataset. Free API key; fields: country, state, city, station, last_update, latitude, longitude, pollutant_id, pollutant_min, pollutant_max, pollutant_avg.
- **Official daily city AQI:** CPCB's daily AQI bulletin (4 PM, 24-hour average). Columns are city, AQI, prominent pollutant(s), and stations participated/total. CPCB states that for multi-station cities the **average** of stations is used, and notes that averaging is not scientifically sound but is used for simplicity. That's exactly why we show both the bulletin and the stations. Parse the HTML table once a day, politely (one request, with a user-agent naming the site and a contact email), and keep the source link on the page.
- Attribution on every page: *"Source: Central Pollution Control Board (daily bulletin and real-time data via data.gov.in, Government Open Data License – India)."* **Verify the licence text in week 0.**
- **No third-party AQI numbers** (IQAir, WAQI/aqicn, AccuWeather) are displayed. Their terms restrict commercial reuse; WAQI's explicitly bars use in paid or commercial services without agreement. We *explain* why their numbers differ (US scale, different stations, low-cost sensors, averaging windows) without republishing them.

### 3.2 Week-0 validation: **launch gate, not a checklist**
No SEO or UI work ships publicly until items 1–4 pass. The ingest Worker and archive start **today** regardless, because every hour of data we don't capture is lost.
1. **What is `pollutant_avg`?** Determine whether it's a raw concentration, a running average, or a sub-index. Cross-check 10 stations × 3 hours against CPCB's station dashboard. Document the finding in `/about#methodology`.
2. **Can we reproduce CPCB?** Compute each station's AQI from our archive (24-h running average with at least 16 valid hours, per CPCB) and compare with CPCB's published station AQI. Target: within ±5 AQI points for ≥ 90% of station-hours.
3. **Can we reproduce the bulletin?** Our 4 PM city value (mean of valid station AQIs) should be within ±10% of the bulletin for ≥ 90% of launch cities, 7 days running. If not, find out why (different station sets, validity rules) before launch.
4. **Abnormal-value rules.** CPCB warns that its automated live data can contain abnormal or error readings, so we filter: negative values, flat-lined sensors (identical value 6+ hours), physically impossible jumps (e.g. PM2.5 +400 µg/m³ in 1 h that the neighbouring stations don't show), and PM2.5 > PM10 at the same station-hour. Flag, don't delete: raw data stays in the archive, flagged values are excluded from AQI.
5. Measure how many stations report each hour and how stale `last_update` gets; confirm pagination limits.
6. Build the station → city slug map by hand for the **first 10–15 cities**, including Hindi names. Watch for duplicate names such as Aurangabad (MH/BR).

### 3.3 NAQI engine (`packages/aqi`, pure TS, unit-tested)
Implement CPCB's National AQI exactly:
- Sub-index by linear interpolation within the breakpoints below; overall AQI is the **max** sub-index; the **dominant pollutant** is the argmax.
- Validity rule: at least **3 pollutants, one of which must be PM2.5 or PM10**. Otherwise show "Insufficient data", never a guess.
- Averaging: PM10, PM2.5, NO₂, SO₂ and NH₃ use a 24-hour running average (at least 16 valid hours required); CO and O₃ use the 8-hour max. Compute these **from our own archive**, which is why the archive must start today. By the 10 Oct soft launch there will be about 13 days of history. Don't assume the feed's values alone reproduce CPCB's AQI until the §3.2 gate proves it.

| Category | AQI | PM10 | PM2.5 | NO₂ | O₃ (8h) | CO mg/m³ (8h) | SO₂ | NH₃ |
|---|---|---|---|---|---|---|---|---|
| Good | 0–50 | 0–50 | 0–30 | 0–40 | 0–50 | 0–1.0 | 0–40 | 0–200 |
| Satisfactory | 51–100 | 51–100 | 31–60 | 41–80 | 51–100 | 1.1–2.0 | 41–80 | 201–400 |
| Moderate | 101–200 | 101–250 | 61–90 | 81–180 | 101–168 | 2.1–10 | 81–380 | 401–800 |
| Poor | 201–300 | 251–350 | 91–120 | 181–280 | 169–208 | 10.1–17 | 381–800 | 801–1200 |
| Very Poor | 301–400 | 351–430 | 121–250 | 281–400 | 209–748 | 17.1–34 | 801–1600 | 1201–1800 |
| Severe | 401–500 | 430+ | 250+ | 400+ | 748+ | 34+ | 1600+ | 1800+ |

Units are µg/m³ unless noted. **Re-verify every number against CPCB's published NAQI document before shipping.** Write tests for each boundary value.

- **US AQI (secondary toggle):** compute from the same concentrations using EPA breakpoints, including the 2024 PM2.5 revision. Label it "US EPA scale (for comparison)".
- **City numbers: never call our number "official".**

| Label on page | What it is | Updated |
|---|---|---|
| **"Official · CPCB 4 PM bulletin"** | CPCB's published city AQI, displayed as-is, with a link to the bulletin | Daily |
| **"Live estimate · Saans"** | Mean of valid station AQIs, **the same method CPCB uses for its bulletin**, so it tracks the official number between bulletins. Always shown with the station range and count ("38 of 40 stations · 142–361"). | Hourly |
| **Station AQI** | Each station's AQI computed with CPCB's method from our archive | Hourly |

  The big hero number is the **live estimate** (people want "now"), labelled as such. The official bulletin value sits directly beneath it with its timestamp. Neither is hidden. Methodology is one click away.

### 3.4 D1 schema (v1)
```sql
stations(id TEXT PK, name, city_slug, state_slug, lat REAL, lon REAL, first_seen, last_seen, active INT)
-- ONE wide row per station-hour (keeps D1 writes ≈ 12K/day, under the 100K/day free cap)
station_hour(station_id, hour_utc TEXT,
         pm25 REAL, pm10 REAL, no2 REAL, so2 REAL, co REAL, o3 REAL, nh3 REAL,   -- feed values as received
         flags TEXT,                     -- e.g. "pm25:flatline,pm10:spike" (see §3.2 item 4)
         naqi INT, us_aqi INT, dominant TEXT, valid INT,
         PRIMARY KEY(station_id, hour_utc))
city_hour(city_slug, hour_utc, naqi_mean INT, naqi_min INT, naqi_max INT, stations_valid INT, stations_total INT,
         dominant TEXT, PRIMARY KEY(city_slug, hour_utc))
bulletin(city_slug, date TEXT, aqi INT, prominent TEXT, stations_used INT, stations_total INT, source_url TEXT,
         our_4pm INT, delta_pct REAL, PRIMARY KEY(city_slug, date))
cities(slug PK, state_slug, name_en, name_hi, lat, lon, population_rank, tier INT, indexable INT)
grap(date PK, stage TEXT, source_url TEXT)   -- manually curated from CAQM orders
```

### 3.5 Freshness and failure states
- **Fresh:** data under 90 min old, shown with a green dot.
- **Delayed:** 90 min to 6 h old, shown amber: "Data delayed (last update 14:00)".
- **Stale:** over 6 h old, shown grey. Hide the big number and show the last known value in small text.
- If a city has had no valid data for 72 h, set `noindex` until it recovers.

---

## 4. Information architecture: lean by design

**Rule: 4 templates, about 26 URLs at soft launch and about 55 at Diwali.** Every page must earn its place with real data or a real question. Anything that can be a *section* is a section, not a page. Fewer, stronger pages rank better for a new domain, crawl faster, and stay clear of Google's scaled-content and doorway-page signals.

English at the root and Hindi under `/hi/`, with `hreflang` pairs on every page. Slugs are always Latin script.

| # | Template | URL (EN / HI) | Absorbs (no separate page) | Target queries | Count |
|---|---|---|---|---|---|
| 1 | **Home = live India map + near me** | `/` · `/hi/` | Near-me, rankings (top 5 worst / cleanest), India map, Diwali banner in season | aqi, aqi near me, aqi of my location, aqi today, most polluted city today | 2 |
| 2 | **City** | `/aqi/{city}` · `/hi/aqi/{city}` | Stations (anchors + map pins), GRAP (Delhi-NCR only), 24-hour chart, **history section** (grows with the archive), nearby cities, FAQ | delhi aqi, aqi delhi today, anand vihar aqi, दिल्ली AQI | 10 × 2 by 10 Oct → 25 × 2 by Diwali |
| 3 | **Guide** (one long article) | `/aqi-explained` · `/hi/aqi-explained` | AQI full form, meaning, categories, PM2.5 vs PM10, NAQI vs US, "why apps disagree", a mini calculator widget | aqi full form, aqi meaning, pm2.5 meaning | 2 |
| 4 | **Static** | `/about` (includes methodology and data sources) · `/privacy` (includes terms and disclaimer) | Contact, methodology, affiliate disclosure | Trust pages (needed for AdSense) | 2–4 |

**Growth rule: Search Console decides.** Add the next batch of 25 cities only when at least 70% of the existing city pages are indexed **and** getting impressions. The path is 10 → 25 → 50 → 100 → 150, never all at once.

**Dropped or deferred, and why**
| Idea | Decision |
|---|---|
| Station pages (500+) | **Dropped.** Stations become `#station-anand-vihar` anchors on the city page plus map pins. This avoids 500 thin, near-duplicate pages. Station-name queries still land on the city page. |
| `/aqi-near-me`, `/aqi-ranking`, `/grap`, `/diwali-aqi-2026` | **Merged** into Home or the City page as sections. |
| Separate learn articles (5) | **Merged** into one strong `/aqi-explained` guide with anchor links. One authoritative page beats five thin ones. |
| `/aqi-calculator` page | Folded into the guide as a widget. |
| State hub pages | **Dropped.** Map and home cover navigation. |
| City history | **Section first, page later.** From about 30 days of archive, the city page shows a "Last 30 days" calendar strip (daily mean, category colours). A separate `/aqi/{city}/history` URL goes live for the **top 5–10 cities** once they have at least 90 days of data (early January 2027), with monthly charts, worst days and a downloadable CSV. Earlier than that, a history page would be thin. |
| Compare pages | Season 2, top-20 cities only. |
| Buying guides | **One** page late in October (`/air-purifier-guide`), only if you enable affiliate links. |
| Weather | Season 2, as a *section* on the existing city pages first (Hindi "आज/कल का मौसम"), not a new URL tree. |

**URL notes:** `/aqi/{city}` has no state segment (shorter and cleaner). Duplicate city names get a state suffix: `/aqi/aurangabad-maharashtra`, `/aqi/aurangabad-bihar`. Common aliases 301-redirect (`/aqi/gurgaon` → `/aqi/gurugram`, `/aqi/bangalore` → `/aqi/bengaluru`).

**Anti-thin-content rules.** A city page exists only where at least one active station exists. Each page must render real, page-specific data: the value, the range, the stations, a 24-hour chart, nearby cities and the dominant pollutant. Hand-written copy lives only on the guide and about pages. No AI-spun "About {city} air" paragraphs.

### 4.1 City rollout
- **Wave 1: 10 cities (soft launch, 10 Oct).** Delhi, Noida, Gurugram, Ghaziabad, Faridabad, Mumbai, Pune, Kolkata, Bengaluru, Lucknow. That's Delhi-NCR (where the season's search volume is) plus the largest metros.
- **Wave 2: +15 cities (by 25 Oct).** Greater Noida, Chandigarh, Jaipur, Kanpur, Agra, Varanasi, Patna, Ahmedabad, Hyderabad, Chennai, Bhopal, Indore, Nagpur, Ludhiana, Meerut.
- **Wave 3+: only if Search Console says so.** Candidates: Amritsar, Jodhpur, Prayagraj, Muzaffarpur, Dehradun, Navi Mumbai, Thane, Surat, Howrah, Visakhapatnam, Raipur, Guwahati, Bhubaneswar, Kochi, Thiruvananthapuram…

A city is added only once its station mapping has passed the §3.2 validation for 7 days.

---

## 5. Page blueprints

### 5.1 Home (`/`): map + near me + rankings in one page
Everything above the fold works with **zero JavaScript**; the map and location are progressive enhancements.

1. **Headline + location bar:** "How's the air where you are?" There are three ways in, in priority order:
   - **Auto city (no prompt):** the edge detects the visitor's approximate city from their IP and fills the "Your city" card instantly (see §5.3).
   - **"Use my location" button:** asks for precise GPS and shows the nearest station.
   - **Search box:** city or area, in English or Hindi.
2. **"Your city" card:** AQI, category, freshness, and a "See full details →" link to the city page.
3. **Live India map (clickable):** a server-rendered SVG of India's official outline with one dot per launch city, coloured by AQI. Clicking a dot opens a small card with the city, AQI and a "View city" link. Details in §5.3.
4. **Today's extremes:** the 5 worst and 5 cleanest cities, as links. This replaces a rankings page.
5. **Seasonal banner (Oct–Jan only):** GRAP stage for Delhi-NCR, and on Diwali night a live hourly strip for Delhi.
6. **One ad slot** below the fold, a short "What is AQI?" teaser linking to the guide, and the footer.

### 5.2 City page (`/aqi/{city}`)
Order is fixed. Everything above the fold must work with **zero JavaScript**.

1. **AQI hero:** the big number is the **live estimate**, labelled "Live estimate · Saans". Also shown: category, dominant pollutant, station range ("38 of 40 stations · 142–361"), freshness badge, and the NAQI | US scale toggle. Directly beneath, a line reads **"Official CPCB bulletin (4 PM today): 294 · Poor ↗"**, and a "How is this calculated?" link goes to the methodology.
2. **"Aaj bahar?" verdict card:** four rule-based rows: walk/run outside, kids outdoor play, open windows, mask. The wording is a simplified rendering of CPCB's health statement for the current category, not AI and not medical advice. The card footer says "Based on CPCB category guidance for 'Poor' ↗" and links to the source and methodology.
3. **"Nearest to you" chip (enhancement):** if the visitor has granted location, show "Your nearest station: Shivajinagar, 2.1 km · AQI 118".
4. **24-hour bars + best window:** server-rendered SVG, one bar per hour, category-coloured, plus a line such as "Cleanest air in the last 24 h: 2–5 pm".
5. **Station map (clickable):** city stations as coloured pins; tapping a pin shows station name, AQI, main pollutant and updated time, and scrolls to its row. **At launch this is the static SVG station map** (clickable pins, zero JS). The interactive MapLibre version (§5.3 B) comes after Diwali. Details in §5.3.
5a. **"Where the number comes from" panel (collapsed by default):** a 3-row table: Official CPCB bulletin 294 (4 PM, 36/40 stations) · Saans live estimate 287 (mean of 38 valid stations, 8 PM) · Station range 142–361. Below it are two lines on why these differ (time window, station set) and one on why other apps show different numbers (US scale, different or low-cost sensors). This is our distinctive feature, built from CPCB data only.
5b. **Last 30 days (from about 30 days of archive):** a calendar strip of daily means, category-coloured. It grows into the history page for top cities in January.
6. **Stations table:** each row carries an `id` anchor (`#station-anand-vihar`) so station-name searches land here. Sortable (small island).
7. **Pollutant breakdown:** PM2.5, PM10, NO₂, O₃, CO, SO₂, NH₃. Monospace values, each with a bar showing its position within the category band.
8. **GRAP section (Delhi-NCR cities only):** current stage and the CAQM order link.
9. **Nearby cities strip:** 6 internal links with live AQI chips.
10. **Share button:** "Share today's air" produces a 1080×1350 image and a WhatsApp deep link.
11. **Ad slots:** one after the pollutant breakdown, one after the stations table, both with reserved height. Never above the verdict card.
12. **FAQ:** 4 questions filled from data ("What is Delhi's AQI right now?", "Which area of Delhi has the worst air today?"). Only true, data-driven answers.
13. **Source and disclaimer footer.**

### 5.3 Map and "use my location": technical spec

**A. Home map: SVG, no map library (0 KB JS to render)**
- Base: a simplified India outline plus state borders as a TopoJSON file (about 40–60 KB), pre-rendered at build time into an inline SVG path (projection done once, not in the browser).
- **Use India's official boundary** (Survey of India-compliant, including the whole of J&K, Ladakh and Arunachal Pradesh). Source it from a Survey of India-aligned dataset (for example DataMeet's India maps; check the licence) and **not** from a world dataset. Showing a different boundary is a legal and reputational risk in India.
- Each city is an SVG `<a href="/aqi/{city}">` containing a `<circle>` (category fill) plus a visually hidden label. It's clickable and crawlable with JS off, and screen readers get a list of links.
- A small island (about 3 KB) adds hover/tap cards (city, AQI, category, "View city →") and a "Show: NAQI / US" sync with the toggle.
- Refresh: the page is edge-cached for 10 minutes, so the dots are at most about 10 minutes behind the data.

**B. City station map: MapLibre + Protomaps, lazy-loaded (after Diwali, Phase 4)**
- **Launch version (Phase 2):** the static SVG station map: station dots on the city outline, each an `<a href="#station-…">` link, with the same tap cards as the home map. It's zero-JS, robust, and enough for the season.
- **Upgrade (Phase 4):** the interactive map below, once the data pipeline is stable. It adds risk (tiles, boundaries, WebGL) and no SEO value, so it doesn't belong on the pre-Diwali critical path.
- The map only loads when the section scrolls into view **or** the user taps "Show map". Until then, a static placeholder (a pre-rendered SVG of station dots, about 5 KB) holds the space, so there's no layout shift.
- Library: MapLibre GL JS (about 220 KB gz), loaded **only** on this interaction and excluded from the initial page budget.
- Basemap: a **Protomaps PMTiles** extract of India (zoom 0–13) stored on an **R2 public bucket on its own subdomain**, read by the PMTiles client with HTTP range requests. Tiles never pass through a Worker, so they don't use the invocation quota. It's self-hosted, free for commercial use, and needs no Google/Mapbox key. Style: Protomaps' `light`/`dark` grayscale flavour, so the only colour is the AQI pins. Attribution: "© OpenStreetMap contributors, Protomaps".
- Hide the basemap's boundary lines and draw the official India boundary as an overlay layer (same source as A).
- Data: `GET /api/stations/{city}.geojson` (edge-cached 10 min; about 5 KB per city), rendered as a circle layer coloured by category. Tap → popup card + `history.replaceState` to `#station-…` + highlight the table row.
- Controls: zoom ± and "Locate me" only. No rotate/pitch (disable `dragRotate` and `touchPitch`).
- Fallback: if WebGL is unavailable, keep the static SVG station dots, which are still clickable links to their anchors.

**C. Location detection: automatic, then precise**

| Step | What happens | Permission prompt? | Accuracy |
|---|---|---|---|
| 1. Returning visitor | City saved in `localStorage` (slug only) → shown instantly | No | Exact choice |
| 2. Already-granted GPS | `navigator.permissions.query({name:'geolocation'})` returns `granted` → silently get the position and show the nearest station | No (granted earlier) | ~10–100 m |
| 3. First visit: **auto city** | Island calls `GET /api/here` (no-store). The Worker reads Cloudflare's `request.cf.latitude/longitude/city` and returns the nearest launch city's snapshot. Label it "Showing Pune · approximate". | **No** | City-level; can be wrong on mobile networks (carrier gateways often geolocate to a metro), which is why step 4 exists |
| 4. "Use my location" tap | `getCurrentPosition({enableHighAccuracy:false, timeout:8000, maximumAge:600000})` → nearest valid station found on the client using haversine over the stations JSON | Yes, only on user tap | ~10–100 m |

Nearest-station logic:
- Consider only stations with **valid, fresh** AQI (under 3 h old).
- Show "Nearest station: Shivajinagar · 2.1 km · AQI 118", plus the city AQI and a link to the city page.
- If the nearest station is more than 25 km away: "No monitoring station within 25 km. Nearest: Nashik (38 km)." Never pretend to hyperlocal accuracy.
- If the user is outside all covered cities, show the nearest covered city and the list.

Privacy (write this into `/privacy`):
- Precise coordinates **never leave the browser**. The nearest-station maths runs on the client.
- `/api/here` uses the IP-derived location only for the response and **does not log or store** it.
- `localStorage` keeps only the chosen city slug.
- Handle every failure silently: permission denied, timeout, or no HTTPS falls back to the auto city plus search, with a one-line message ("Location unavailable. Pick your city.").

**Never prompt for location on page load.** Browsers penalise it, users deny it, and a denial is permanent for the site.

---

## 6. Features I added beyond the brief (and why)

| Feature | Why it matters |
|---|---|
| **"Where the number comes from" panel** | Official bulletin vs live estimate vs station range, side by side, from CPCB data only. aqi.in already publishes explainers on why readings differ, so an *article* isn't a differentiator. **Showing the numbers side by side on every city page, with reproducible maths, is.** |
| **Daily reconciliation against CPCB's bulletin** | An internal check (our 4 PM value vs the official one) that catches pipeline bugs within a day. Publish the running accuracy on `/about` ("Our live estimate was within 10% of CPCB's bulletin on 96% of days"). That's a trust signal competitors don't show. |
| **"Aaj bahar?" verdict card** | Google can show a number in the SERP but not a household decision. This is click-worthy utility. |
| **Station range, not just an average** | More honest, and station anchors on the city page catch long-tail searches ("anand vihar aqi", "worst area in Delhi today") without creating extra pages. |
| **Clickable live map + automatic location** | IP-based city with no prompt, GPS on tap, nearest station with distance. It answers "aqi near me", one of India's biggest AQI queries, in one tap. |
| **Archive from day one → R2** | A new builder can copy the frontend in a weekend but can't recreate 18 months of station-hour observations. It enables the history section (from ~30 days), history pages (from ~90 days), Diwali 2026 vs 2027, and a dataset for journalists and researchers. This is the main compounding moat. |
| **Share cards (WhatsApp-first)** | Search authority takes months, but the pollution season is 10 weeks, and WhatsApp is how Indian families actually talk about "aaj ka AQI". |
| **Living logo** | The dot in the wordmark and favicon takes the current AQI colour of the visitor's city. It's memorable and costs about 20 lines of code. |
| **GRAP section (Delhi-NCR pages + home banner)** | Delhi-NCR searches spike on every GRAP stage change. It's manually curated from CAQM orders, so it's high-trust and quick to update. |
| **Low-bandwidth budget** | Budget Android on patchy 4G is the median user. JS under 40 KB per page, page weight under 200 KB, no web-font flash. |
| **Colour-blind safety** | Colour is always paired with a label and number. Very Poor and Severe are separated by lightness as well as hue. |
| **Festival mode (a home banner, not a page)** | On Diwali night the home banner shows a live hourly strip for Delhi; next year it compares with this year's archive. It's a natural press and social hook. |

---

## 7. Tech stack and repo layout

```
saans/
├─ apps/web/                 Astro site
│  ├─ src/pages/             index, aqi/[city], aqi-explained, about, privacy, api/here, api/stations/[city]
│  ├─ src/components/        AqiHero.astro, VerdictCard.astro, HourBars.astro, IndiaMap.astro, ...
│  ├─ src/islands/           ScaleToggle, CitySearch, StationSort, LocateMe, MapCards, StationMap (lazy)
│  ├─ src/data/india.topo.json   official-boundary outline (pre-projected at build time)
│  ├─ src/i18n/              en.json, hi.json, cities.hi.json
│  ├─ src/styles/app.css     Tailwind v4 @theme tokens (from DESIGN.md)
│  └─ astro.config.mjs       output: 'server', adapter: cloudflare()
├─ workers/ingest/           Cron Worker: fetch → validate → D1/KV/R2
├─ packages/aqi/             NAQI + US AQI engine + tests (vitest)
├─ packages/data/            city/station slug maps, Hindi names
├─ DESIGN.md
├─ PLAN.md
└─ AGENTS.md                 (short: "follow DESIGN.md; never invent data; run tests")
```

| Concern | Choice | Note |
|---|---|---|
| Framework | Astro, SSR with the Cloudflare adapter | Islands keep JS near zero |
| Styling | Tailwind v4 (`@tailwindcss/vite`), tokens in `@theme` | No component library |
| Islands | Preact (≈ 4 KB) | Only for toggle, search, sort, locate-me, map cards |
| Charts | Hand-written server-side SVG | Zero-JS charts; add uPlot only if interactive charts are ever needed |
| India map (home) | Pre-projected SVG from TopoJSON, built with `d3-geo` **at build time only** | 0 KB runtime; each dot is a real `<a>` link |
| Station map (city) | MapLibre GL JS + Protomaps PMTiles on R2 | Lazy (in view or on tap); ~220 KB gz, excluded from the initial budget |
| Location | Cloudflare `request.cf` (auto city) + Geolocation API (precise, on tap) | Coordinates never stored; nearest-station maths on the client |
| Fonts | Geist Sans, Geist Mono, Noto Sans Devanagari (self-hosted, subset, `font-display: swap`) | Preload only Geist Sans 400/600 Latin |
| Share images | `workers-og` / Satori at the edge, cached 15 min | 1200×630 OG and 1080×1350 story |
| City search | Static JSON index (EN + HI names, aliases like "Gurgaon" → Gurugram) | Client fuzzy match, under 8 KB |
| Analytics | Cloudflare Web Analytics | Free, cookieless |
| Ads | AdSense with fixed-height slots | Apply once the guide, about/privacy and 20 city pages are live |
| Monitoring | Ingest Worker posts to a Telegram bot on 2 consecutive failed runs | You'll know before users do |

**Performance budget (enforced in CI with Lighthouse CI on 3 URLs):** initial JS ≤ 40 KB gz, CSS ≤ 20 KB gz, HTML ≤ 60 KB (home ≤ 90 KB including the inline India SVG), fonts ≤ 90 KB total, LCP element = the AQI number (text, not an image). The MapLibre bundle and tiles load only after interaction and are not counted, but the city page must still reach LCP < 1.8 s with the map section in view.

---

## 8. SEO checklist

- Title pattern: `Delhi AQI Today: 287 (Poor) · Live Air Quality | Saans`. The number sits in the title because it's live and rendered at the edge. Hindi: `दिल्ली AQI आज: 287 (खराब) · लाइव वायु गुणवत्ता`.
- Meta description includes the station range and dominant pollutant.
- JSON-LD: `WebPage` + `Dataset` (city history pages) + `BreadcrumbList` + `FAQPage` (FAQ rich results are gone, but the markup is harmless and structures the data).
- `hreflang` en-IN / hi-IN pairs plus `x-default`; self-canonicals.
- One sitemap (about 26 URLs at soft launch, about 55 at Diwali), regenerated daily. `lastmod` is the date data last changed, not every hour.
- Internal links: every city page links to its 6 nearest cities and home. Home links to every indexable city twice (map dots and the city list in the footer), so no hub pages are needed.
- API routes (`/api/*`) are `noindex` and disallowed in `robots.txt`.
- Search Console: submit on day 1, and watch the AI Overviews / AI Mode visibility reports.
- Title honesty: the number in the title is the live estimate. Use "Delhi AQI Today: 287 (Poor) · Live" and never "Official Delhi AQI".
- Digital PR: in the first week of November, send a one-page "Where your AQI number comes from: official bulletin vs live stations vs apps" explainer with charts to Delhi newsrooms and climate reporters. This is the backlink plan.

---

## 9. Monetisation (Season 1 reality)

| Stream | When | Notes |
|---|---|---|
| AdSense | Apply mid-Oct | Max 2 display units on city pages, none above the AQI hero. Expect low India RPM, so treat ads as a bonus. |
| Amazon Associates India | From late Oct | Links only from `/air-purifier-guide` and one contextual line in the verdict card when AQI > 200. You need 3 qualifying sales within 180 days or the account closes. |
| Purifier guide (one page) | Late Oct | "Air purifier for your room: what CADR you need", with a built-in CADR calculator and a short, honest monitor section. |
| Free widget | S2 | "Embed live AQI for your city": a free embed with attribution, used as backlink bait. |

**Long-term ladder (don't build ahead of traffic):** ads → affiliate → widgets → cleaned historical dataset / API (CSV downloads, then a paid tier) → B2B leads. Competitors like aqi.in/Prana Air and Airveda monetise through hardware, apps and B2B, not ads, so ad revenue alone won't carry this. The archive is what eventually makes a data product possible. Before selling any data derived from CPCB, re-check the GODL-India licence terms for commercial redistribution.

Honesty rules: label affiliate links, never rank products you haven't researched, and no health claims beyond CPCB's advisories.

---

## 10. Timeline

Solo-builder scope: **10 perfect cities first, then 25.** Most of the time goes on debugging data (feed quirks, missing pollutants, station mapping, stale readings), not on Astro.

| Phase | Dates | Scope | Done when (gate) |
|---|---|---|---|
| **1 · Perfect data, 10 cities** | 27 Sep – 10 Oct | **Day 1: ingest Worker + archive live.** NAQI engine + tests, abnormal-value filters, bulletin parser + daily reconciliation, station mapping for 10 cities, city page (EN) with the hero, the "where the number comes from" panel, stations table and 24-hour chart, `/about` methodology, Search Console | §3.2 gate passes: station AQI within ±5 of CPCB for ≥ 90% of station-hours, and the 4 PM estimate within ±10% of the bulletin for 9 of 10 cities, 7 days running. **Soft launch 10 Oct.** |
| **2 · India SEO MVP** | 11 – 25 Oct | Up to 25 cities (each only after passing validation), Hindi mirror, home page with SVG India map, location flow (auto city + GPS nearest station), static SVG station maps, share cards, GRAP section, `/aqi-explained`, `/privacy`, purifier guide, AdSense application | Lighthouse mobile ≥ 95; location works on Android Chrome + iOS Safari; map dots clickable with JS off. **Public launch 25 Oct.** |
| **3 · Diwali distribution** | 26 Oct – 15 Nov | Daily WhatsApp/X share cards, Hindi and local-language posts, daily AQI snapshot posts, Diwali banner live on 8 Nov, journalist outreach with the "where the number comes from" explainer | Share rate ≥ 2% of city-page sessions; first press mention |
| **4 · Expand what works** | 16 Nov – 31 Jan 2027 | Add cities in batches of 25 **only** where Search Console shows impressions; interactive MapLibre station map (§5.3 B); "Last 30 days" history section on all city pages | Growth rule in §4 met before each batch |
| **5 · History pages** | Jan 2027 | `/aqi/{city}/history` for the top 5–10 cities (90+ days of data), with CSV downloads | Each history page has ≥ 90 days of valid data |
| **Season 2** | Feb – Jun 2027 | Hindi weather as a section on city pages, compare pages for the top 20 | Year-round traffic floor |
| **Season 3 prep** | Jul – Sep 2027 | Marathi, Tamil, Telugu; web-push alerts; Diwali 2026 vs 2027 comparisons ready | Ready before Oct 2027 |

---

## 11. Costs (Season 1)

| Item | Cost |
|---|---|
| Domain (.in or .com) | ₹800–1,500/yr |
| Cloudflare Workers, D1, KV, R2 | ₹0 on the free tier. Move to Workers Paid (US$5/mo ≈ ₹450) when **Worker invocations** approach 100K/day. That's about 30–50K visits/day with assets and tiles served outside the Worker (§2), but watch the dashboard, not visitor counts. |
| data.gov.in API | Free |
| Map tiles (Protomaps India extract on R2) | ₹0: a single self-hosted file; check its size fits R2's 10 GB free tier (cap max zoom at 13 if needed) |
| India boundary data | Free (check the source licence) |
| Fonts (Geist OFL, Noto OFL) | Free |
| **Total to launch** | **Under ₹2,000** |

---

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| data.gov.in feed outage or schema change | Medium | Schema validation, alerting, visible "data delayed" states; never show a guessed number |
| Google SERP card or AI Overview absorbs the clicks | High | Win on the verdict card, station range, share cards and history, which a SERP card can't give |
| New domain doesn't rank this season | High | Treat Season 1 as a social and data-collection season; SEO compounds into Season 2 |
| Thin/scaled-content classification | Medium | Rules in §4; noindex on no-data pages; no templated filler text |
| Wrong AQI maths damages trust | Low if tested | Boundary tests, the §3.2 launch gate, and daily automated reconciliation against the CPCB bulletin with alerts |
| Presenting our estimate as "official" | Medium (easy copy mistake) | Labels fixed in §3.3; "official" is used **only** for the CPCB bulletin value; a copy review before launch |
| CPCB live feed contains abnormal readings | High | Abnormal-value filters (§3.2 item 4); flagged values excluded but archived |
| Competitors already ship the same features (aqi.in: alerts, weather, maps, history, widgets; IQAir: forecasts, recommendations) | Certain | Don't compete on feature count. Compete on transparency, archive, Hindi and speed; see §0 |
| D1 free-tier write cap | Medium | Wide station-hour rows (§3.4), about 12K writes/day |
| Health-advice liability | Low | Only CPCB advisory text, a clear disclaimer, and no medical claims |
| Map shows a non-official India boundary | Medium if using world data | Official boundary overlay (§5.3 A/B), hide basemap borders, review at z4–z8 before launch |
| IP-based "auto city" is wrong (mobile carriers) | High in some regions | Always labelled "approximate", with a one-tap "Use my location" beside it; remember the user's correction |

---

## 13. Build prompts (for Codex / Claude Code, run in order)

1. *"Read PLAN.md §3 and implement `packages/aqi`: NAQI and US AQI sub-index and overall calculators with the validity rule. Write vitest tests covering every breakpoint boundary in the §3.3 table. No other code."*
2. *"Implement `workers/ingest` per PLAN.md §3: hourly Cron Trigger, fetch the data.gov.in feed with pagination, validate with zod, apply the abnormal-value flags in §3.2 item 4, and upsert **one wide row per station-hour** into the D1 schema in §3.4 with batched writes. Compute station AQI from 24-h running averages (≥ 16 valid hours) and city mean/min/max, write `city:{slug}:latest` to KV, and dump yesterday's rows to R2 at 00:30 IST. Add a daily 17:15 IST job that parses CPCB's 4 PM bulletin table into `bulletin`, stores our 4 PM value and the delta, and alerts on a delta over 10%. Add Telegram alerting after 2 failed runs."* **Run this one first, today; the archive can't be back-filled.**
3. *"Scaffold `apps/web` with Astro + Tailwind v4 + the Cloudflare adapter. Put the DESIGN.md tokens into `src/styles/app.css` under `@theme`. Build the layout, nav, footer and the components in DESIGN.md §4. Match DESIGN.md exactly; do not introduce new colours."*
4. *"Build the city page per PLAN.md §5.2 using KV/D1 data, including the hero labels in §3.3 (live estimate vs official bulletin), the 'where the number comes from' panel (5a), and the static SVG station map. Zero JS above the fold. Add freshness states per §3.5 and noindex rules per §4."*
5. *"Add the Hindi mirror with Astro i18n routing, hreflang, and Hindi strings from `src/i18n/hi.json`. Apply DESIGN.md's Devanagari typography rules."*
6. *"Build the home page per PLAN.md §5.1 and the home SVG India map per §5.3 A and DESIGN.md §4.16: pre-project the official-boundary TopoJSON with d3-geo at build time, render city dots as `<a>` links, and add the MapCards island. Zero runtime map library."*
7. *"Build the location flow per PLAN.md §5.3 C and DESIGN.md §4.18: `/api/here` using `request.cf` (no logging), the LocateMe island with the Permissions API check, client-side haversine nearest station, the 25 km rule, and all failure states. Never prompt on page load."*
8. *(Phase 4, after Diwali)* *"Build the lazy StationMap island per PLAN.md §5.3 B and DESIGN.md §4.17: MapLibre + Protomaps PMTiles from the R2 public bucket via range requests, grayscale style, official boundary overlay, circle layer from `/api/stations/{city}.geojson`, pin tap → popup + scroll to `#station-…`. Load only on intersect or tap; static SVG fallback without WebGL."*
9. *"Add share-card OG images, the GRAP section, the sitemap and JSON-LD per §4 and §8. Run Lighthouse CI against the §7 budget."*

---

## 14. Open decisions for you

1. The final brand name and domain.
2. Hindi-first (`/` = Hindi) or English-first (`/` = English, `/hi/` = Hindi). This plan assumes **English-first** for simpler AdSense review. Switch to Hindi-first if WhatsApp distribution turns out to be the main channel.
3. Whether to include cigarette-equivalent framing (aqi.in uses it). It's catchy, but it's a contested estimate. This plan leaves it out for trust.

---

## 15. Review log (v3, 26 Sep 2026)

External review points, and how each was handled:

| Review point | Verdict | Change |
|---|---|---|
| Don't call our city median "official CPCB AQI" | **Accepted, and strengthened.** CPCB's own daily bulletin uses the station average and notes that averaging isn't scientifically sound but is used for simplicity. | Three labelled numbers: official bulletin, Saans live estimate (station mean, CPCB's own method), station range (§3.3). The bulletin is ingested daily and reconciled (§3). |
| Competitors (aqi.in, IQAir) already have the planned features | Accepted | Positioning changed to transparency + archive + Hindi + speed (§0); competitor row added to risks |
| "Why apps disagree" isn't a differentiator | Partly accepted | An article isn't; the per-city side-by-side panel with reproducible maths is (§5.2 item 5a) |
| Archive is the strongest idea | Agreed | Ingest ships first, today (§13 prompt 2) |
| Launch history pages early | **Modified** | A history *section* from about 30 days; separate history URLs only from 90+ days of data (Jan 2027), to avoid thin pages |
| 40 cities before Diwali is too much | Accepted | 10 cities (10 Oct) → up to 25 (25 Oct) → Search Console decides |
| Feed can contain abnormal readings; `pollutant_avg` meaning is a launch blocker | Accepted | §3.2 is now a hard launch gate with numeric pass criteria and abnormal-value filters |
| 16-hour minimum / running averages | Accepted | Averages computed from our own archive (§3.3) |
| Cloudflare "100K/day" wording | Accepted | It's Worker invocations, not visits; assets and tiles moved off-Worker (§2). **Also found:** D1's 100K rows written/day cap would be hit by narrow rows, so the schema moved to wide station-hour rows (§3.4) |
| Share KPI → share rate | Accepted | shares ÷ sessions ≥ 2% (§1) |
| Verdict card must not look like medical advice | Accepted | Framed as CPCB category guidance with source link (§5.2 item 2) |
| Add a source comparison with other networks | **Modified** | CPCB-only comparison (bulletin vs live vs stations). Third-party numbers aren't republished because of licence restrictions (WAQI bars commercial use without agreement) (§3.1) |
| Monetisation beyond ads | Accepted | Long-term ladder in §9; dataset licence check noted |
| Spend effort on data + SEO + trust, not UI | Accepted | 70/30 rule in §0; the interactive MapLibre map moved after Diwali, with the static SVG map at launch |
| Competitor station counts (IQAir ~867 Indian stations, Airveda 9,000+ globally) | Not independently verified | Doesn't change any decision |

---

## 16. Build log (v4, 27 Sep 2026): what the build found and changed

Built as a monorepo (see README.md). Facts below were **verified**, not assumed; each changed the plan.

| # | Plan said | Found / changed | Why it matters |
|---|---|---|---|
| 1 | Feed field `pollutant_avg`; compute station AQI from our archive (≥ 16 h warm-up) | Fields are `min_value/max_value/avg_value`, and `avg_value` is CPCB's **sub-index**, not a concentration (inverting it matches CPCB's 17-year concentration archive: CO 28 → 0.56 mg/m³). Station AQI = max sub-index. | No warm-up: correct numbers from the first hour. §3.2 items 1–2 closed. |
| 2 | Bulletin is an HTML table | It is a **PDF** (`cpcb.gov.in/upload/Downloads/AQI_Bulletin_YYYYMMDD.pdf`), online back to **2015**, in three layouts; all parsed (unpdf, inside the Worker). | The bulletin job and reconciliation work; see 3. |
| 3 | History section from ~30 days, history pages from Jan 2027 | **Backfilled 391 official bulletins** (1 Sep 2025 → 26 Sep 2026, 94,065 city-days) in 7 minutes. The "Last 30 days" strip launches with official data; history pages and Diwali 2025-vs-2026 are possible now. | The archive moat starts 11 years deep instead of at zero. |
| 4 | §3.2 gate: ±10% for ≥ 90% of launch cities | Replayed real feed rows at 16:00 IST (20 & 23 Sep): **97% of 478 city-days within ±10%, 85% identical; 49/50 launch city-days**. The Worker itself reconciled 25/25 (21 identical) on real data. `npm run gate` repeats it. | The "live estimate" is provably CPCB's method. |
| 5 | Hand-built station → city map | The feed's `city` field **is** CPCB's bulletin grouping (Delhi 43 stations ↔ "43/46"). | New stations join automatically; no mapping drift. |
| 6 | Free Cloudflare tier covers Season 1 | Free Workers have **10 ms CPU** per invocation; parsing 3,300 rows and a 14-page PDF needs far more. **Budget Workers Paid, US$5/mo**, from day one. | Otherwise the archive silently fails. |
| 7 | KV key per city | One KV value (`bundle:v1`) per hour; D1 tables `WITHOUT ROWID`. | KV free tier allows 1,000 writes/day; one key = 24/day at any city count. |
| 8 | Archive = D1 rows + daily CSV | Plus the **raw API response every hour** in R2 (`raw/…json.gz`) before any parsing. | Parser bugs can be fixed retroactively. |
| 9 | — | `POST /ingest` fallback: any machine can push raw records if data.gov.in blocks Cloudflare's IPs (it throttles bursts and answers HTTP 429 to the sample key). | A second path into the archive. |
| 10 | "Cleanest air in the last 24 h: 2–5 pm" | Dropped. Each hourly value is a 24-h running average, so its minimum does not say when air was cleanest. The chart states the trend and what the bars are. | Avoids a misleading claim. |
| 11 | US AQI from all pollutants | Only PM2.5/PM10 (24 h) and O₃/CO (8 h), 2024 EPA table. EPA scores NO₂/SO₂ on 1-h values; CPCB's are 24-h. | Honest comparison. |
| 12 | NAQI by linear interpolation | CPCB's formula on the printed bands, gaps interpolated — so SO₂ 381 is Poor (201), not 200. Exact inverse kept. | Every printed band edge lands in its own category (tested). |
| 13 | Share cards via Satori/workers-og | Drawn on a canvas in the browser, shared via the native share sheet (WhatsApp). | No WASM in the Worker, no render cost. |
| 14 | Preact islands | Vanilla TS modules: **~6 KB JS per page** (budget 40 KB). | Less to ship and nothing to hydrate. |
| 15 | Map: one dot per launch city | Plus every other CPCB city as a small context dot; "most polluted / cleanest" is all-India. NCR inset sits over Tibet, off Indian territory. | A national picture on day one. |
| 16 | Static station map on a blank panel | Real coastline and state borders around each city (DataMeet, CC BY 4.0). | Mumbai's sea and Delhi's NCT border give the dots meaning. |
| 17 | Fonts self-hosted | Noto Sans Devanagari declared **`local()` first**: Android ships it, so most readers download 0 KB of the 104 KB Devanagari font. | Keeps Hindi pages inside the font budget on the median phone. |
| 18 | Hosting | Cloudflare as planned. "Vercel" is the design language only (Hobby is non-commercial and its cron is daily). | — |

**Measured (production build, local workerd):** JS ≈ 6 KB gz/page, CSS 8.2 KB gz, typical city page 60–65 KB HTML (13–15 KB gz); Delhi (44 stations) 100 KB (21 KB gz); home 102 KB (28 KB gz); render 24–40 ms; AQI number above the fold at 360×640; no horizontal scroll at 360 px.

**Still yours to decide or do:** brand and domain; a data.gov.in API key; the Cloudflare account steps in README.md; GRAP status from CAQM (hidden until curated); a copy review of the verdict card's mask row (CPCB's health statements do not mention masks; the Health Ministry advisory URLs were 404 when checked); AdSense and analytics IDs.

### 16.1 Round 2 (27 Sep 2026, after review of the first build)

| Feedback | Change |
|---|---|
| "Need zoom in and out on the map" | Zoom/pan on both maps with no map library (~3 KB). The India map adds **semantic zoom**: every CPCB station past 2.5×, AQI numbers in the pins past 5×. City maps show numbers in pins and a live scale bar. |
| "Search looks very black" | Palette rebuilt: lifted surface in dark mode (#1A1A1A on a blurred page), content-height, grouped results (cities · stations & areas · other CPCB cities), recent and popular cities, "Use my location" inside it, tighter matching ("gur" no longer returns Bengaluru). Home search is one large light field; "Use my location" is a secondary pill. Dark cards lifted to #111. |
| "Share option in city looks black" | Share is a soft wash of the city's own air colour and opens a share sheet: live preview, Post 4:5 / Status 9:16, English / Hindi, share image, WhatsApp, copy link, download. |
| "Something off with the dates" | Root cause: the dev data shifted the live reading to *now* but left the bulletin and 30-day strip on 25 Sep. The fixture now moves whole days and only shows a bulletin CPCB would already have published. In the product: the map heading shows date + time + age; station times from another day carry the date; FAQ and share-card dates come from the reading, not the clock. |
| "Do something innovative" | **Replay of CPCB's official daily AQI** for every city (30 days, and Diwali 2025 from the backfill) · **same day last year** on every city page · **station/area search** · semantic zoom to all ~490 stations. |

Also found and fixed: every icon rendered empty since the first build (a `/node_modules` glob inside a hoisted workspace); share previews could show a stale card after quick toggles (now sequence-guarded).
