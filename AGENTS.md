# AGENTS.md

Rules for any coding agent working in this repo. PLAN.md is the product plan,
DESIGN.md decides every UI question, README.md has commands and deploy steps.

1. **Never invent data, and never blur where a number came from.** Every
   number is either a CPCB measurement or a labelled model value:
   - **Official, daily:** CPCB's 4 PM bulletin PDF (`bulletin.ts`). Unaffected
     by the outage and still the only "official" figure.
   - **Live estimate, hourly:** CAMS via Open-Meteo (`cams.ts`), corrected
     per city against recent bulletins. It is a **model, not a measurement**,
     it has no stations behind it, and every surface that shows it says so
     (`CityNow.source === 'cams'`).

   CPCB's machine-readable feed died in Sep 2026 — data.gov.in refuses
   connections, its legacy JSON endpoints 404, and every free redistributor
   went down with it (WAQI stale since 2026-06-23, OpenAQ has no Indian
   locations). Don't reintroduce a station feed without checking it is alive.
   Dev data comes from `npm run fixture`. Guide and FAQ examples are computed
   with `@saans/aqi`, never typed in.
2. **"Official" means CPCB's bulletin value only.** Our number is always
   "Live estimate" / "लाइव अनुमान", and while it is modelled it also carries
   "Modelled — CPCB stations offline". `npm run smoke` checks this.
3. **Follow DESIGN.md exactly.** No new colours, fonts, radii or shadows; the
   AQI category is the only colour. No gradients, no emoji, no red outside
   Very Poor air. Never negative letter-spacing on Hindi.
4. **Zero JS above the fold.** Scripts only enhance. Every map dot is a link;
   the calculator and search work without JS.
5. **Keep CPCB's arithmetic, whatever the source feeds it.** Sub-index per
   pollutant over CPCB's own windows (24 h; 8 h for CO and O3), AQI = max
   sub-index, and CPCB's validity rule (≥ 3 pollutants, one particulate).
   CAMS reports concentrations (CO in µg/m³, NAQI wants mg/m³); the retired
   feed reported sub-indices. The per-city correction scales **sub-indices**,
   not concentrations, so the headline moves by exactly the factor.

   The old target — ≥ 90% within ±10% of the bulletin — was achievable with
   stations and is **not** achievable with a model: uncorrected CAMS matched
   0% of launch cities within 10% on 29 Sep 2026. Corrected and measured over
   539 city-days to 26 Sep 2026: about **28% within 10%, 72% within 25%, 92%
   within 50%**, with at least one city clamped at the 0.2 floor. Publish that
   band; never restore the old accuracy claim while the number is modelled,
   and re-measure rather than quoting these figures if the method changes.
6. **Before you finish:** `npm test`, `npm run check`, and `npm run smoke`
   against a running dev server. Check 360 px and 1440 px, light and dark,
   EN and HI.
7. Browser scripts in `apps/web/src/scripts` must be ES modules (`export {}`)
   and must not use `@cloudflare/workers-types` (it overrides DOM types).
8. Windows: Vite's dependency scanner misreads `<script` inside comments and a
   line starting with `import:` in `.astro` frontmatter — avoid both.
9. Import packages by name (`lucide-static/icons/x.svg?raw`), never by a
   `/node_modules/...` path: npm workspaces hoist them to the repo root.
10. Map dot sizes are CSS (`r: calc(var(--r) * 1px / var(--z))`); give new dots a
   `--r` and the `map-dot` class, or they will grow when zoomed.
