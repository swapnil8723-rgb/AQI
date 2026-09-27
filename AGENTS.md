# AGENTS.md

Rules for any coding agent working in this repo. PLAN.md is the product plan,
DESIGN.md decides every UI question, README.md has commands and deploy steps.

1. **Never invent data.** Every number on the site comes from CPCB (the
   data.gov.in feed or the bulletin PDF) through `packages/pipeline`. Dev data
   comes from `npm run fixture`, which replays real archived rows. Guide and
   FAQ examples are computed with `@saans/aqi`, never typed in.
2. **"Official" means CPCB's bulletin value only.** Our number is always
   "Live estimate" / "लाइव अनुमान". `npm run smoke` checks this.
3. **Follow DESIGN.md exactly.** No new colours, fonts, radii or shadows; the
   AQI category is the only colour. No gradients, no emoji, no red outside
   Very Poor air. Never negative letter-spacing on Hindi.
4. **Zero JS above the fold.** Scripts only enhance. Every map dot is a link;
   the calculator and search work without JS.
5. **The feed reports sub-indices, not concentrations.** Station AQI = max
   sub-index with CPCB's validity rule; city = mean of valid stations.
   Changing any of this must keep `npm run gate` at ≥ 90% within ±10%.
6. **Before you finish:** `npm test`, `npm run check`, and `npm run smoke`
   against a running dev server. Check 360 px and 1440 px, light and dark,
   EN and HI.
7. Browser scripts in `apps/web/src/scripts` must be ES modules (`export {}`)
   and must not use `@cloudflare/workers-types` (it overrides DOM types).
8. Windows: Vite's dependency scanner misreads `<script` inside comments and a
   line starting with `import:` in `.astro` frontmatter — avoid both.
