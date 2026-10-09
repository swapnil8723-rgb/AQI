/**
 * Tell Bing (and every IndexNow engine: Yandex, Seznam, Naver) that the
 * sitemap's pages changed. Bing also feeds ChatGPT search, Copilot and
 * DuckDuckGo. Google does not use IndexNow — it reads the sitemap.
 *
 *   SITE_URL=https://saans-web.swapnil-8723.workers.dev node scripts/indexnow.ts
 *
 * The key is public by design: the engines confirm it by fetching
 * {SITE_URL}/{KEY}.txt (apps/web/public), so the site must be deployed first.
 * Run it after a deploy that adds or renames pages, not hourly.
 */
export {};

const KEY = 'f9d50ea2e136f12f61e59e111ffa3c95';
const site = (process.env.SITE_URL ?? '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(site)) {
  console.error('Set SITE_URL to the public origin, e.g. SITE_URL=https://saans.in');
  process.exit(2);
}

const key = await fetch(`${site}/${KEY}.txt`);
if (!key.ok || (await key.text()).trim() !== KEY) {
  console.error(`${site}/${KEY}.txt is not serving the key — deploy the site first.`);
  process.exit(1);
}

const xml = await (await fetch(`${site}/sitemap.xml`)).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
if (!urlList.length) {
  console.error('sitemap.xml has no URLs');
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key: KEY, keyLocation: `${site}/${KEY}.txt`, urlList }),
});
// 200 = accepted, 202 = accepted, key check pending.
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
