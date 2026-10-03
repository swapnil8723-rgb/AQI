# DESIGN.md — Saans (India AQI + Weather)

> Vercel-inspired design system (Geist, monochrome precision, shadow-as-border), adapted for a live air-quality product used mostly on budget Android phones in English and Hindi.
> Coding agents: **follow this file for every UI decision.** Do not add colours, fonts, shadows or radii that are not defined here. All contrast ratios below were computed against WCAG 2.1.

---

## 1. Visual Theme & Atmosphere

**"The air is the only colour."**

The interface chrome is strict black-and-white Vercel precision: white canvas, near-black text, hairline borders drawn with shadows, and Geist type with tight tracking. The **only saturated colour on any page is the current air-quality category**. When Delhi is Severe, the hero turns maroon; when Bengaluru is Satisfactory, it turns soft green. Nothing else competes, so the data *is* the brand.

- Mood: calm, factual, instrument-like. A precision gauge, not a news alarm.
- Density: generous on marketing and learn pages, compact and tabular on data sections.
- Voice in UI: short and declarative. "Poor. Limit long runs outside." Not "Uh-oh! 😷".
- Signature detail: the **living dot**. The wordmark `saans●` and the favicon dot take the category colour of the visitor's selected city.

---

## 2. Color Palette & Roles

### 2.1 Neutral system (UI chrome)

| Token | Light | Dark | Role | Contrast (on its own bg) |
|---|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0A0A0A` | Page background | — |
| `--bg-subtle` | `#FAFAFA` | `#111111` | Section bands, table header, input bg | — |
| `--bg-muted` | `#F2F2F2` | `#1A1A1A` | Hover fill, skeletons | — |
| `--fg` | `#171717` | `#EDEDED` | Headings, primary text | 17.9 / 16.9 |
| `--fg-muted` | `#4D4D4D` | `#A1A1A1` | Body secondary, descriptions | 8.45 / 7.66 |
| `--fg-subtle` | `#666666` | `#8F8F8F` | Meta, timestamps, captions (min 12 px) | 5.74 / 6.12 |
| `--ring` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.10)` | Shadow-as-border hairline | — |
| `--ring-strong` | `rgba(0,0,0,0.16)` | `rgba(255,255,255,0.18)` | Hover/active border | — |
| `--link` | `#0070F3` | `#52A8FF` | Inline links in articles, focus ring | 4.55 / 7.92 |

Rules
- `#8F8F8F` and `#A1A1A1` are **not** text colours on light backgrounds (3.2 : 1 and 2.6 : 1). Use them only for icons and dividers in light mode.
- Primary buttons are **inverted neutrals** (`--fg` bg, `--bg` text), exactly like Vercel. They are never AQI-coloured.

### 2.2 AQI category colours (the only accents)

Hues are aligned with CPCB's National AQI colours and tuned for screens. Each category has four roles:
- **fill**: large surfaces (hero panel, bars, pills).
- **on**: text placed *on* the fill.
- **ink**: category-coloured text on a light background.
- **ink-dark**: category-coloured text on a dark background.

| Category (EN / HI) | AQI | fill | on (ratio) | ink on #FFF (ratio) | ink-dark on #0A0A0A (ratio) |
|---|---|---|---|---|---|
| Good / अच्छा | 0–50 | `#00B050` | `#0A0A0A` (6.9) | `#00754A` (5.8) | `#3DDC84` (11.1) |
| Satisfactory / संतोषजनक | 51–100 | `#92D050` | `#0A0A0A` (10.7) | `#4D7A12` (5.1) | `#A8E063` (12.7) |
| Moderate / मध्यम | 101–200 | `#FFE600` | `#0A0A0A` (15.6) | `#7A5E00` (6.1) | `#FFE14D` (15.2) |
| Poor / खराब | 201–300 | `#FF9900` | `#0A0A0A` (9.3) | `#9A4D00` (6.1) | `#FFB347` (11.1) |
| Very Poor / बहुत खराब | 301–400 | `#FF0000` | `#0A0A0A` (5.0) | `#C00000` (6.5) | `#FF6B6B` (7.1) |
| Severe / गंभीर | 401–500 | `#A50021` | `#FFFFFF` (8.0) | `#8C0000` (9.9) | `#FF8A8A` (8.7) |
| No data | — | `#E5E5E5` / dark `#262626` | `--fg-muted` | `--fg-subtle` | `--fg-subtle` |

**US EPA scale** (shown only when the toggle is on) reuses the same six slots in order: Good, Moderate, Unhealthy for Sensitive Groups, Unhealthy, Very Unhealthy, Hazardous. Never mix both scales' colours on one screen.

Rules
- Colour is **never** the only signal. Every fill carries the number *and* the category word.
- Very Poor (bright red) and Severe (dark maroon) are separated by **lightness**, not just hue, for colour-blind users. Keep that gap.
- Tinted washes: use `color-mix(in oklab, var(--aqi-fill) 10%, var(--bg))` for soft backgrounds behind category content. Max one tinted wash per viewport.

### 2.3 Tailwind v4 tokens (`src/styles/app.css`)

```css
@import "tailwindcss";

@theme {
  --font-sans: "Geist", "Noto Sans Devanagari", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-deva: "Noto Sans Devanagari", "Geist", sans-serif;

  --color-bg: #FFFFFF;        --color-bg-subtle: #FAFAFA;   --color-bg-muted: #F2F2F2;
  --color-fg: #171717;        --color-fg-muted: #4D4D4D;    --color-fg-subtle: #666666;
  --color-link: #0070F3;

  --color-good: #00B050;         --color-good-ink: #00754A;
  --color-satisfactory: #92D050; --color-satisfactory-ink: #4D7A12;
  --color-moderate: #FFE600;     --color-moderate-ink: #7A5E00;
  --color-poor: #FF9900;         --color-poor-ink: #9A4D00;
  --color-verypoor: #FF0000;     --color-verypoor-ink: #C00000;
  --color-severe: #A50021;       --color-severe-ink: #8C0000;

  --radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 12px;

  --shadow-ring:   0 0 0 1px rgba(0,0,0,0.08);
  --shadow-card:   0 0 0 1px rgba(0,0,0,0.08), 0 2px 2px rgba(0,0,0,0.04);
  --shadow-raised: 0 0 0 1px rgba(0,0,0,0.08), 0 4px 8px -2px rgba(0,0,0,0.06), 0 12px 24px -8px rgba(0,0,0,0.08);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

/* Dark mode: system preference unless the user chose light; explicit data-theme wins */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --color-bg:#0A0A0A; --color-bg-subtle:#111111; --color-bg-muted:#1A1A1A;
    --color-fg:#EDEDED; --color-fg-muted:#A1A1A1; --color-fg-subtle:#8F8F8F; --color-link:#52A8FF;
    --color-good-ink:#3DDC84; --color-satisfactory-ink:#A8E063; --color-moderate-ink:#FFE14D;
    --color-poor-ink:#FFB347; --color-verypoor-ink:#FF6B6B; --color-severe-ink:#FF8A8A;
    --shadow-ring:0 0 0 1px rgba(255,255,255,0.10);
    --shadow-card:0 0 0 1px rgba(255,255,255,0.10);
    --shadow-raised:0 0 0 1px rgba(255,255,255,0.12), 0 12px 24px -8px rgba(0,0,0,0.6); }
}
:root[data-theme="dark"] { /* same values as the block above */ }

/* A component sets the active category once; children read --aqi-* */
[data-aqi="good"]         { --aqi-fill: var(--color-good);         --aqi-on:#0A0A0A; --aqi-ink: var(--color-good-ink); }
[data-aqi="satisfactory"] { --aqi-fill: var(--color-satisfactory); --aqi-on:#0A0A0A; --aqi-ink: var(--color-satisfactory-ink); }
[data-aqi="moderate"]     { --aqi-fill: var(--color-moderate);     --aqi-on:#0A0A0A; --aqi-ink: var(--color-moderate-ink); }
[data-aqi="poor"]         { --aqi-fill: var(--color-poor);         --aqi-on:#0A0A0A; --aqi-ink: var(--color-poor-ink); }
[data-aqi="verypoor"]     { --aqi-fill: var(--color-verypoor);     --aqi-on:#0A0A0A; --aqi-ink: var(--color-verypoor-ink); }
[data-aqi="severe"]       { --aqi-fill: var(--color-severe);       --aqi-on:#FFFFFF; --aqi-ink: var(--color-severe-ink); }

body { background: var(--color-bg); color: var(--color-fg); }
.tabular { font-variant-numeric: tabular-nums; }
```

---

## 3. Typography Rules

**Families**
- **Geist Sans**: all UI and Latin text. Weights 400, 500, 600 only.
- **Geist Mono**: numbers in tables, pollutant values, timestamps, labels and code. Weight 400/500.
- **Noto Sans Devanagari**: all Hindi text. Weights 400, 600. (Geist has no Devanagari; never let the browser fall back to a random system font.)

Self-host all fonts (`@fontsource`), subset Latin and Devanagari separately with `unicode-range`, and set `font-display: swap`. Preload only Geist Sans 400 + 600 Latin.

**Scale** (desktop → mobile via `clamp()`)

| Token | Size / line-height | Tracking | Weight | Use |
|---|---|---|---|---|
| `aqi-hero` | `clamp(96px, 22vw, 168px)` / 0.9 | -0.06em | 600, tabular | The big AQI number only |
| `display` | `clamp(36px, 6vw, 56px)` / 1.05 | -0.045em | 600 | Home headline |
| `h1` | `clamp(30px, 4.5vw, 44px)` / 1.1 | -0.04em | 600 | Page titles ("Delhi air quality") |
| `h2` | `clamp(22px, 3vw, 28px)` / 1.2 | -0.03em | 600 | Section titles |
| `h3` | 18px / 1.35 | -0.02em | 600 | Card titles |
| `body-lg` | 18px / 1.6 | -0.01em | 400 | Learn articles |
| `body` | 16px / 1.6 | 0 | 400 | Default |
| `small` | 14px / 1.5 | 0 | 400 | Secondary UI |
| `label` | 12px / 1.3, **Geist Mono**, uppercase | 0.04em | 500 | Section eyebrows, table headers ("PM2.5 · µg/m³") |

**Devanagari rules (critical)**
- **Never apply negative letter-spacing to Devanagari.** It breaks conjuncts and matras. Scope it: `:lang(hi) { letter-spacing: 0 !important; }`.
- Add +0.15 to line-height for Hindi (`:lang(hi) { line-height: calc(var(--lh) + 0.15); }`). Matras and descenders need room.
- Hindi headings use weight 600, one step smaller than the English equivalent (Devanagari reads larger).
- Digits stay Latin (0–9) in both languages. Indian users read AQI numbers in Latin digits.
- Set `lang="hi"` on the `<html>` element of Hindi pages, and on inline Hindi spans in English pages.

---

## 4. Component Stylings

### 4.1 Nav
- Height 64 px, sticky, `bg/80` with `backdrop-blur-md`, bottom hairline via `--shadow-ring` (inset bottom only).
- Left: wordmark `saans` in Geist 600, 20 px, -0.04em, plus the **living dot**: an 8 px circle in `--aqi-fill` of the selected city (neutral `--fg` if unknown).
- Centre (desktop): the city search trigger styled like Vercel's ⌘K input: 280 px, `--bg-subtle`, `--shadow-ring`, radius 6, placeholder "Search city or area…", with a `/` kbd hint in mono.
- Right: `EN | हिं` language switch (text links, not a dropdown) and a theme toggle icon button.
- Mobile: wordmark + search icon + language switch. No hamburger. The site has few top-level pages; put them in the footer.

### 4.2 AQI Hero panel (`AqiHero.astro`)
The one place the colour floods.
```
┌──────────────────────────────────────────────┐  radius-lg, bg = --aqi-fill, text = --aqi-on
│ NEW DELHI · LIVE ESTIMATE ● 18 min ago [NAQI|US]  label (mono, 12px) + FreshnessBadge + ScaleToggle
│                                              │
│ 287                                          │  aqi-hero, tabular
│ Poor · खराब                                  │  h2 weight 600
│ PM2.5 · 38 of 40 stations · 142–361          │  small, opacity .8
│ ──────────────────────────────────────────── │  1px rule in --aqi-on at 20%
│ Official CPCB bulletin (4 PM): 294 · Poor ↗  │  small, weight 500, links to the bulletin
│ How is this calculated? →                    │  small, underline, links to /about#methodology
└──────────────────────────────────────────────┘
```
- **Labelling rule (non-negotiable):** the big number is always captioned "Live estimate" / "लाइव अनुमान". The word "Official" / "आधिकारिक" appears **only** next to the CPCB bulletin value. Never style our estimate as official.
- Before today's bulletin is published (before about 5 PM), show yesterday's bulletin with its date ("Official CPCB bulletin (yesterday, 4 PM): 301").
- Padding 32 px desktop, 24 px mobile. No shadow (colour is enough). No gradient, pattern or illustration.
- When there's no data, use the No-data fill with the text "Data delayed from CPCB. Last reading 287 at 14:00." Never hide the uncertainty.
- The number is plain text (it's the LCP element): no count-up animation, no SVG, no canvas.

### 4.3 FreshnessBadge
Mono 12 px. A 6 px dot plus relative time. Fresh (under 90 min) = `--color-good` dot with a 2 s pulse (disabled under reduced motion). Delayed = `--color-poor` dot. Stale = `--fg-subtle` dot plus the word "Stale". Always include the absolute time in `title` and in visually hidden text.

### 4.4 ScaleToggle (island)
Segmented control: 2 segments `NAQI` / `US`, height 28 px, radius 6, container `--shadow-ring` at 16% on the fill. The active segment has `bg: rgba(255,255,255,.9)` with `--fg` text (or `rgba(0,0,0,.25)` with white on Severe). Persist the choice in `localStorage` wrapped in try/catch. Default is always NAQI.

### 4.5 VerdictCard ("Aaj bahar?")
- Card: `--bg`, `--shadow-card`, radius-md, padding 20.
- Title h3: "What to do today" / "आज क्या करें".
- Four rows, 48 px min height, each: 20 px line icon (Lucide, stroke 1.5, `--fg-muted`) · label · verdict aligned right.
- Verdicts use `--aqi-ink` of the *verdict's own severity*: "OK" (good ink), "Shorten it" (poor ink), "Avoid" (verypoor ink), plus a text word. Never icons alone.
- Footnote in `small --fg-subtle`: "Based on CPCB health advisory for 'Poor'."

### 4.6 HourBars (24-hour chart, server SVG)
- 24 bars, 4 px gap, bar radius 2 (top only), height proportional to AQI with a 500 cap. Each bar uses its own category fill.
- X-axis labels every 6 h in mono 11 px `--fg-subtle`. No y-axis. Label the current and max bars directly ("Now 287", "Peak 361 at 22:00").
- Dashed hairline at the category boundary nearest the current value.
- Each bar is a `<rect>` with a `<title>`; wrap the chart in `<figure>` with a `<figcaption>` text summary for screen readers.

### 4.7 PollutantRow
Grid: name (`label` mono) | value (Geist Mono 20 px tabular) with a unit in `small --fg-subtle` | 120 px band bar showing position within its category range, filled with that pollutant's category colour | category word in `--aqi-ink`. Row height 56, hairline divider between rows.

### 4.8 StationsTable
- `--bg` card, `--shadow-card`, header row `--bg-subtle` with `label` mono headers.
- Columns: Station · AQI (tabular, with a 10 px category square before the number) · Main pollutant · Updated.
- Rows 48 px; hover `--bg-muted`. Sort buttons in the headers (island). On mobile, collapse to 2-line rows (station name / AQI + pollutant).

### 4.9 CityChip / Nearby strip
Pill 32 px, radius full, `--shadow-ring`, text 14 px: `Noida  ■ 301`. The square is the category fill. Horizontal scroll on mobile with scroll-snap and **no scrollbar hiding** (keep it discoverable).

### 4.10 Buttons
| Variant | Style |
|---|---|
| Primary | `bg --fg`, `text --bg`, radius 6, h 40, px 16, weight 500; hover opacity .88 |
| Secondary | `bg --bg`, `--shadow-ring`, `text --fg`; hover `--ring-strong` + `--bg-subtle` |
| Ghost | text only, hover `--bg-muted` |
| Share (WhatsApp) | secondary style + WhatsApp glyph; label "Share today's air" |
Min tap target 44×44 on mobile (pad the hit area if the visual is 40).

### 4.11 ShareCard (generated image, 1080×1350 and 1200×630)
- Top 62%: the category fill with the city name (Geist 600 64 px), the AQI number (Geist 600 280 px, tabular), and the category word in EN + HI.
- Bottom 38%: white with the date, "Main pollutant PM2.5", "Worst area: Anand Vihar 361", "Cleanest: Lodhi Road 142", and the wordmark with the living dot plus the URL `saans.in/delhi`.
- No emoji, no stock photos, no watermark noise.

### 4.12 GrapStageMeter
Horizontal stepper of 4 segments (I–IV), 8 px tall, radius full. Active stages are filled `--fg`, inactive `--bg-muted`. Show the stage name in h3, the effective date in mono, and a link to the CAQM order. Neutral colours only. GRAP is policy, not air.

### 4.13 AdSlot
Fixed min-height (mobile 280, desktop 250), `--bg-subtle`, radius-md, `label` "Advertisement" centred above. Never above the AQI hero, never between the hero and the verdict card.

### 4.14 Inputs / Search palette
Input h 40, radius 6, `--bg-subtle`, `--shadow-ring`; focus: `--shadow-ring` + `0 0 0 3px color-mix(in oklab, var(--color-link) 35%, transparent)`. The search palette opens as a centred modal on desktop and full-screen on mobile. Results show city name EN + HI, state, and the live AQI chip.

### 4.14a SourcePanel ("Where the number comes from")
The product's signature component. It must feel like an audit trail, not a marketing box.
- A `<details>` element (works with JS off), collapsed by default. Summary row: `label` mono "WHERE THIS NUMBER COMES FROM" + chevron. Card: `--bg`, `--shadow-card`, radius-md.
- Body is a 3-row table in Geist Mono, tabular numbers:
  | Source | AQI | Basis | Time |
  |---|---|---|---|
  | Official · CPCB bulletin | 294 | Mean of 36/40 stations, 24-h avg | 4 PM |
  | Live estimate · Saans | 287 | Mean of 38/40 valid stations, 24-h running avg | 8 PM |
  | Station range | 142–361 | Lowest to highest station | 8 PM |
  Each AQI cell has a 10 px category square before the number.
- Below the table: 2–3 short lines in `small --fg-muted` explaining the difference in this case (time window, station set), and one line: "Other apps may show different numbers because they use the US scale, different stations or low-cost sensors." Link: "Full methodology →".
- No third-party numbers, logos or brand names in this panel.

### 4.15 Footer
`--bg-subtle`, top hairline. Four columns: Cities (all launch cities as plain links), AQI explained, About & methodology, Privacy. Data attribution line in `small`: "Source: CPCB via data.gov.in (GODL-India). Figures are provisional and unvalidated. Map data © OpenStreetMap contributors, Protomaps." Plus the methodology link.

### 4.16 IndiaMap (home, server SVG)
The home page's centrepiece. It must look like an instrument, not a tourism map.
- Canvas: `--bg-subtle` panel, radius-lg, `--shadow-ring`, aspect about 1:1.1 (India's shape), max width 560 px on desktop, full width on mobile.
- Country fill `--bg`; state borders 0.5 px `--ring-strong`; country outline 1 px `--fg-subtle`. No terrain, no labels except the 8 largest cities (mono 11 px `--fg-subtle`).
- **City dots:** radius scales with station count (6–12 px). Fill = category colour, 2 px `--bg` stroke so neighbouring dots in NCR stay separable. Severe dots get a static 3 px outer ring in `--color-severe` at 30% (no pulsing). While the live value is modelled (no stations), launch cities are 6 px and the map note says size means "has a city page".
- **Every other CPCB city** is a 3.5 px dot (1 px stroke) — also a link with a card. It has no page, so its link is `/#map=7/lat/lon` and the card's action is "Zoom in here →", which zooms the map to it and reopens its card. Names in the home worst/cleanest lists without a page use the same link.
- Each dot is an `<a>` with `aria-label="Delhi, AQI 287, Poor"`. Hit area at least 44 px (invisible larger circle behind). Where hit areas overlap, the dot **nearest the pointer** wins, not the topmost.
- **Tap/hover card (island):** `--shadow-raised`, radius-md, 220 px wide: city name (h3), AQI number (Geist Mono 28 px) + category pill, freshness ("Modelled estimate · 20 min ago" while modelled; state first for cities without a page), for launch cities "Official CPCB · 2 Oct: 95" in `--fg-muted` (India scale only), and "View city →" (primary text link). Desktop shows it on hover or focus; mobile shows it on first tap, and a second tap (or the link) navigates. It sits beside the dot when it fits, otherwise below it (above near the bottom edge) — never over the dot it describes.
- **Zoom:** past 2.5× the NCR inset gives way to real positions. With a station feed, stations replace the cities; without one, the cities stay, and past 5× every dot becomes a 12 px pin with its AQI inside (Geist Mono, `--aqi-on`).
- **Legend:** a single horizontal row under the map with the 6 category squares + labels (EN/HI), mono 11 px. It switches to US labels when the scale toggle is US.
- Delhi-NCR cluster: a small inset "zoom" circle (120 px) near the NCR, drawn at 4× scale, so the 6 NCR dots are tappable.

### 4.17 StationMap (city page)
- **Launch version (static SVG, Phase 2):** the city outline in `--bg` on a `--bg-subtle` panel, station dots styled exactly like IndiaMap dots (category fill, 2 px `--bg` stroke, 44 px hit area), each an `<a href="#station-…">`, with the same tap card. Height 280 px mobile / 360 px desktop.
- **Interactive version (MapLibre, Phase 4, after Diwali):** the specs below.
- **Placeholder state (before load):** the same panel style as IndiaMap, height 360 px mobile / 440 px desktop, showing a static SVG of station dots and a centred secondary button "Show interactive map". This reserves the height (no CLS).
- **Loaded state:** grayscale Protomaps style (light: land `#FAFAFA`, water `#EDEDED`, roads `#E5E5E5`, labels `#8F8F8F`; dark: land `#111111`, water `#0A0A0A`, roads `#1F1F1F`, labels `#666666`). **The pins are the only colour.**
- Pins: MapLibre circle layer, radius 9 (zoom ≤ 11) → 12 (zoom ≥ 13), category fill, 2 px `--bg` stroke; the selected pin gets a 4 px `--fg` stroke. Show the AQI number inside the pin (Geist Mono 10 px, `--aqi-on`) from zoom 12.
- Popup: the same card style as the IndiaMap card (station name, AQI, main pollutant, updated time), with "See in table ↓".
- Controls: bottom-right stack of 2 icon buttons (32 px, `--bg`, `--shadow-card`, radius 6): zoom +/- and locate. No compass. Attribution in `small --fg-subtle`, bottom-left.
- The official India boundary overlay is 1 px `--fg-subtle`; the basemap's own boundary lines are hidden.
- **Scroll trap prevention:** on mobile, one-finger drag scrolls the page and two fingers pan the map (MapLibre `cooperativeGestures`), with the hint text "Use two fingers to move the map".

### 4.18 LocateMe (button + states)
The location entry point on the home page and inside the city hero area.

| State | UI |
|---|---|
| Idle, auto city known | Secondary button with a crosshair icon: "Use my location". Above it, `small --fg-subtle`: "Showing Pune · approximate". |
| Idle, nothing known | Primary button: "Use my location" + search input beside it |
| Requesting | Button disabled, label "Finding you…", a 12 px spinner (the only spinner in the product) |
| Success | Result card: "Nearest station **Shivajinagar** · 2.1 km" (mono distance), AQI number + category pill, and "Open Pune →". The map (if present) flies to the user with a 10 px `--fg` dot + 20% halo. |
| Far (> 25 km) | Same card with a neutral note: "No station within 25 km. Nearest: Nashik, 38 km." |
| Denied / timeout / unsupported | Inline text in `--fg-muted` (not red): "Location unavailable. Pick your city." Focus moves to the search input. |

Rules: never auto-prompt; the button stays reachable in the mobile sticky bar (replacing "Change city" with a crosshair + "Near me" on the home page). The precise location is never shown as coordinates. Distances are rounded to 0.1 km.

---

## 5. Layout Principles

- Base unit 4 px. Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128.
- Container: max 1200 px, gutters 16 px (mobile), 24 px (tablet), 32 px (desktop).
- Section rhythm: 96 px desktop, 64 px mobile on home and the guide; **32–40 px on data pages** (data pages are tools, not brochures).
- **City page grid (desktop ≥ 1024):** 12 columns. Hero spans 7, VerdictCard spans 5 alongside it. Below: HourBars full width → Pollutants (7) + Stations (5)… stations table goes full width if > 8 rows.
- **City page (mobile):** single column in PLAN.md §5 order. The AQI number must be visible without scrolling at 360×640.
- **Home (desktop):** 12 columns. Left 5: display headline "How's the air where you are?" / "आपके आसपास की हवा कैसी है?", the LocateMe + search row, then the "Your city" card and today's 5 worst / 5 cleanest lists. Right 7: IndiaMap. No hero illustration; the map *is* the visual.
- **Home (mobile):** headline → LocateMe + search → "Your city" card → IndiaMap (full width) → worst/cleanest lists → guide teaser. The "Your city" card must be above the fold at 360×640.
- **Guide page (`/aqi-explained`):** single 680 px column, `body-lg`, a sticky table of contents on desktop (left rail), and a data "sidecard" (live AQI of Delhi) floating right on desktop.
- **The site has only 4 templates** (home, city, guide, static). Don't design new page types; add sections to these.

---

## 6. Depth & Elevation

Vercel's **shadow-as-border** philosophy: surfaces are separated by 1 px rings, not by heavy shadows or background contrast.

| Level | Token | Used for |
|---|---|---|
| 0 | none | Page, AQI hero (colour is the depth) |
| 1 | `--shadow-ring` | Inputs, chips, table containers, nav bottom |
| 2 | `--shadow-card` | Cards (Verdict, Stations, city tiles) |
| 3 | `--shadow-raised` | Search palette, popovers, toasts |

In dark mode, rings do all the work. Drop blur shadows except on level 3.

Radii: 6 px controls · 8 px cards · 12 px hero/share panel · full for chips/dots. Never mix other radii.

Motion: 150–200 ms `--ease-out` for hover/press; 240 ms fade + 8 px rise for the palette opening. No scroll-jacking, parallax or number count-ups. Respect `prefers-reduced-motion: reduce` by removing pulses and rises.

---

## 7. Do's and Don'ts

**Do**
- Let the AQI category be the *only* colour on the page.
- Show uncertainty: station range, station count, freshness, "provisional".
- Pair every colour with a number and a word, in both languages.
- Use Geist Mono for any number a user might compare.
- Keep data pages dense and scannable, like a Vercel dashboard.
- Write verdicts as instructions: "Avoid long outdoor runs", not "Air is unhealthy!!!".
- Render charts as server SVG with text alternatives.

- Caption our number "Live estimate" everywhere: hero, map cards, share cards, titles.

**Don't**
- Don't use the word "Official" for anything except the CPCB bulletin value.
- Don't use gradients, glassmorphism, 3D gauges, speedometer dials, smoke/fog imagery or scary photos of masked people.
- Don't use emoji faces for categories (aqi.in does, and it reads as cheap and unserious).
- Don't use red for anything that isn't Very Poor air: no red error banners (use `--fg` text with an icon), no red CTA buttons.
- Don't apply negative tracking to Hindi.
- Don't put ads above the fold on city pages.
- Don't auto-animate the AQI number or use skeleton shimmer for the LCP element. The number is server-rendered.
- Don't add a third typeface.

---

## 8. Responsive Behavior

| Breakpoint | Width | Key changes |
|---|---|---|
| base | 360–639 | Single column; hero padding 24; nav collapses; stations as 2-line rows; sticky bottom bar |
| sm | ≥ 640 | City tiles 2 → 3 columns |
| md | ≥ 768 | Pollutants and stations side by side where they fit |
| lg | ≥ 1024 | 12-col grid; hero 7 + verdict 5; search trigger in nav |
| xl | ≥ 1280 | Container locks at 1200 |

- **Sticky bottom bar (mobile):** 56 px, `--bg/92` + blur, top hairline, hidden when the keyboard is open. City pages: "Share today's air" (primary) + "Near me" (secondary, crosshair icon). Home: "Near me" (primary) + search icon button.
- Maps: IndiaMap stays SVG at every width. StationMap height is 360 px below `md` and 440 px from `md`; it never exceeds 60% of the viewport height, so the page stays scrollable around it.
- No horizontal page scroll at 360 px. Test at 360, 390, 768, 1024, 1440.
- Body text is never below 16 px on mobile (this also prevents iOS input zoom).
- Budget: first view at 360 px must work on a 4G connection with JS disabled.

---

## 9. Agent Prompt Guide

Paste one of these, with DESIGN.md in the repo root:

- "Build `AqiHero.astro` per DESIGN.md §4.2. Props: city, naqi, usAqi, category, dominant, stations, min, max, updatedAt. Set `data-aqi={category}` on the root so it reads `--aqi-*` tokens. No client JS except the ScaleToggle island."
- "Build `HourBars.astro` per DESIGN.md §4.6 as a pure SVG from an array of 24 `{hour, aqi, category}` items, with figure/figcaption accessibility."
- "Create the city page layout per DESIGN.md §5 (mobile order from PLAN.md §5, desktop 12-col). Use only tokens from §2.3."
- "Style the Hindi mirror per DESIGN.md §3 Devanagari rules; add a `:lang(hi)` block in app.css."
- "Generate the share image per DESIGN.md §4.11 with Satori at 1080×1350. Use Geist and Noto Sans Devanagari font files from `/public/fonts`."
- "Build `IndiaMap.astro` per DESIGN.md §4.16 from the pre-projected SVG paths and a list of `{slug, name, x, y, aqi, category, stations}`. Dots are `<a>` links; add the NCR inset and legend. The MapCards island only adds the hover/tap card."
- "Build the `StationMap` island per DESIGN.md §4.17: placeholder first, MapLibre on intersect or tap, grayscale style tokens exactly as listed, cooperative gestures on touch."
- "Build `LocateMe` per DESIGN.md §4.18 with every state in the table. No red error text; never prompt on load."
- "Build `SourcePanel.astro` per DESIGN.md §4.14a as a native `<details>` element with the 3-row source table. Props: bulletin {aqi, stationsUsed, stationsTotal, date}, estimate {aqi, valid, total, time}, range {min, max}."
- "Audit this page against DESIGN.md §7 Don'ts and list violations with fixes. Also check that the word 'Official' appears only next to the CPCB bulletin value."

Quality bar before merging any UI: correct at 360 px and 1440 px, light and dark, EN and HI; no new colours; AQI hero readable with JS off; Lighthouse mobile ≥ 95.
