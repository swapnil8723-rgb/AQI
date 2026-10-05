/**
 * Write the favicon files into apps/web/public.
 *
 *   node scripts/favicons.ts
 *
 * The living dot needs one icon per AQI category, and each must be a real URL:
 * Google's favicon crawler ignores data: URIs, so an inline icon never shows up
 * in search results. favicon.svg (neutral dot) is the home page's icon and the
 * one Google picks; icon/<slot>.svg are the city colours; favicon.ico (16/32/48)
 * is for browsers without SVG favicons (older Safari) and the default
 * /favicon.ico request.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const FILL = {
  good: '#00B050', satisfactory: '#92D050', moderate: '#FFE600', poor: '#FF9900', verypoor: '#FF0000', severe: '#A50021',
} as const;
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171717"/><circle cx="16" cy="16" r="8" fill="${fill}"/></svg>`;

const pub = new URL('../apps/web/public/', import.meta.url);
mkdirSync(new URL('icon/', pub), { recursive: true });
const neutral = svg('#fff');
writeFileSync(new URL('favicon.svg', pub), neutral);
for (const [slot, fill] of Object.entries(FILL)) writeFileSync(new URL(`icon/${slot}.svg`, pub), svg(fill));

// ICO: a 6-byte header, one 16-byte entry per image, then the PNGs as-is.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(neutral), { density: (72 * s) / 32 }).resize(s, s).png().toBuffer()));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i]!.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pngs[i]!.length;
});
writeFileSync(new URL('favicon.ico', pub), Buffer.concat([head, ...pngs]));
console.log(`favicon.svg, icon/{${Object.keys(FILL).join(',')}}.svg, favicon.ico (${sizes.join('/')})`);
