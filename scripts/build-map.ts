/**
 * Pre-project India's official boundary into SVG paths, once, at build time
 * (PLAN.md §5.3 A: "projection done once, not in the browser" → 0 KB map JS).
 *
 * Source: DataMeet "States/Admin2" — 36 states and UTs as per the Survey of
 * India map (J&K and Ladakh updated Aug 2021, includes PoK and Aksai Chin).
 * https://github.com/datameet/maps · CC BY 4.0 · attribution on /about.
 *
 *   node scripts/build-map.ts      → apps/web/src/data/india-map.json
 *
 * Output: the country outline, internal state borders, a detailed NCR inset,
 * and the Mercator parameters so the site can place any lat/lon on the map
 * with three multiplications (see apps/web/src/lib/map.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoArea, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
// @ts-expect-error — shapefile ships no types
import * as shapefile from 'shapefile';
import { merge, mesh } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, '.cache', 'map');
const OUT = join(ROOT, 'apps', 'web', 'src', 'data', 'india-map.json');
const OUT_CITIES = join(ROOT, 'apps', 'web', 'src', 'data', 'city-maps.json');

export const WIDTH = 560;
export const HEIGHT = 616;
const PAD = 6;

/** The NCR inset: a circle drawn at 4× around Delhi (DESIGN.md §4.16). */
const NCR_CENTER: [number, number] = [77.25, 28.6];
const NCR_ZOOM = 4;
const NCR_R = 60;

const fc = (await shapefile.read(join(SRC, 'Admin2.shp'), join(SRC, 'Admin2.dbf'))) as FeatureCollection<Polygon | MultiPolygon>;

// d3-geo wants clockwise exterior rings; if a feature covers more than a
// hemisphere its winding is reversed, so flip it.
function rewind(f: Feature<Geometry>): Feature<Geometry> {
  if (geoArea(f as GeoPermissibleObjects) > 2 * Math.PI) {
    const g = f.geometry as Polygon | MultiPolygon;
    if (g.type === 'Polygon') g.coordinates = g.coordinates.map((r) => r.reverse());
    else g.coordinates = g.coordinates.map((p) => p.map((r) => r.reverse()));
  }
  return f;
}
fc.features = fc.features.map((f) => rewind(f) as Feature<Polygon | MultiPolygon>);

/** `keep` is the fraction of points retained (topojson-simplify's quantile semantics). */
function build(keep: number) {
  // Unquantized, so presimplify weighs points by spherical area.
  const topo = topology({ states: fc }) as unknown as Topology<{ states: GeometryCollection }>;
  const pre = presimplify(topo);
  const simp = simplify(pre, quantile(pre, keep)) as Topology<{ states: GeometryCollection }>;
  const states = simp.objects.states;
  return {
    outline: rewind({ type: 'Feature', properties: {}, geometry: merge(simp, states.geometries as never) }),
    borders: mesh(simp, states, (a, b) => a !== b),
  };
}

const coarse = build(Number(process.env.KEEP ?? 0.003));
const projection = geoMercator().fitExtent(
  [
    [PAD, PAD],
    [WIDTH - PAD, HEIGHT - PAD],
  ],
  coarse.outline as GeoPermissibleObjects,
);
const path = geoPath(projection).digits(1);

/**
 * Drop sub-pixel specks that sit beside bigger land (Sundarbans, Andaman
 * reefs) but keep isolated ones: Lakshadweep is all specks at this scale and
 * an official-boundary map must still show it.
 */
function despeckle(f: Feature<Geometry>, minPx: number, nearPx: number): Feature<Geometry> {
  const g = f.geometry as Polygon | MultiPolygon;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const info = polys.map((coords) => {
    const poly: Polygon = { type: 'Polygon', coordinates: coords };
    const [[x0, y0], [x1, y1]] = path.bounds(poly);
    return { coords, area: path.area(poly), c: [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number], box: [x0, y0, x1, y1] };
  });
  const big = info.filter((p) => p.area >= minPx);
  // Real distance to the nearest vertex of bigger land (bounding boxes would
  // swallow Lakshadweep inside the mainland's box).
  const vertices = big.flatMap((p) => p.coords.flatMap((ring) => ring.map((pt) => projection(pt as [number, number])!)));
  const near = (c: [number, number]) => vertices.some(([x, y]) => (x - c[0]) ** 2 + (y - c[1]) ** 2 < nearPx ** 2);
  // Isolated specks are kept, and grouped: one per ~3 px cell is enough to draw them.
  const cells = new Set<string>();
  const kept = info.filter((p) => {
    if (p.area >= minPx) return true;
    if (near(p.c)) return false;
    const cell = `${Math.round(p.c[0] / 3)},${Math.round(p.c[1] / 3)}`;
    if (cells.has(cell)) return false;
    cells.add(cell);
    return true;
  });
  console.log(`despeckle: ${polys.length} polygons → ${kept.length} (${big.length} ≥ ${minPx} px², ${kept.length - big.length} isolated islands)`);
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: kept.map((p) => p.coords) } };
}
const outlineShape = despeckle(coarse.outline, 0.6, 4);

const k = projection.scale();
const [tx, ty] = projection.translate();

// NCR inset at 4×, from finer geometry, clipped to the inset's square.
const fine = build(Number(process.env.KEEP_NCR ?? 0.05));
const inset = geoMercator()
  .scale(k * NCR_ZOOM)
  .center(NCR_CENTER)
  .translate([NCR_R, NCR_R])
  .clipExtent([
    [0, 0],
    [NCR_R * 2, NCR_R * 2],
  ]);
const insetPath = geoPath(inset).digits(1);
const [itx, ity] = inset.translate();
// center() shifts the translate internally; recover the effective raw offset.
const [cx0, cy0] = inset(NCR_CENTER)!;

const out = {
  source: 'DataMeet States/Admin2 (Survey of India boundary, 2021), CC BY 4.0',
  width: WIDTH,
  height: HEIGHT,
  mercator: { k: round(k), tx: round(tx), ty: round(ty) },
  outline: path(outlineShape as GeoPermissibleObjects) ?? '',
  borders: path(coarse.borders) ?? '',
  ncr: {
    center: NCR_CENTER,
    zoom: NCR_ZOOM,
    r: NCR_R,
    // Inset coordinates: x = k·zoom·λ + ix, y = −k·zoom·ln(tan(π/4 + φ/2)) + iy
    ix: round(cx0 - k * NCR_ZOOM * rad(NCR_CENTER[0])),
    iy: round(cy0 + k * NCR_ZOOM * Math.log(Math.tan(Math.PI / 4 + rad(NCR_CENTER[1]) / 2))),
    outline: insetPath(fine.outline as GeoPermissibleObjects) ?? '',
    borders: insetPath(fine.borders) ?? '',
  },
};
void itx;
void ity;

function rad(d: number) {
  return (d * Math.PI) / 180;
}
function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const kb = (s: string) => (s.length / 1024).toFixed(1);
console.log(
  `india-map.json: outline ${kb(out.outline)} KB, borders ${kb(out.borders)} KB, NCR inset ${kb(out.ncr.outline + out.ncr.borders)} KB; mercator k=${out.mercator.k}`,
);
// Sanity: Delhi should land in the north-west third of the map.
const [dx, dy] = projection([77.21, 28.61])!;
console.log(`Delhi at (${dx.toFixed(1)}, ${dy.toFixed(1)}) of ${WIDTH}×${HEIGHT}`);

// ─── City station maps (DESIGN.md §4.17 launch version) ───────────────────
// Coastline and state borders around each launch city's stations, framed on
// the real station spread (scripts/fixture.ts writes .cache/stations.json;
// without it each city gets ±12 km around its centre).
import { CITIES } from '@saans/data';

const CW = 600;
const CH = 400;
const CPAD = 28;
const cityFine = build(Number(process.env.KEEP_CITY ?? 0.2));
const stationFile = join(ROOT, '.cache', 'stations.json');
const pts: { slug: string; lat: number; lon: number }[] = existsSync(stationFile) ? JSON.parse(readFileSync(stationFile, 'utf8')) : [];
const cityMaps: Record<string, unknown> = {};
for (const c of CITIES) {
  const mine = pts.filter((p) => p.slug === c.slug);
  const lats = mine.length ? mine.map((p) => p.lat) : [c.lat];
  const lons = mine.length ? mine.map((p) => p.lon) : [c.lon];
  // At least 24 km across, so a one-station city still shows its surroundings.
  const minHalfLat = 12 / 111;
  const minHalfLon = 12 / (111 * Math.cos(rad(c.lat)));
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const hLat = Math.max((Math.max(...lats) - Math.min(...lats)) / 2 * 1.2, minHalfLat);
  const hLon = Math.max((Math.max(...lons) - Math.min(...lons)) / 2 * 1.2, minHalfLon);
  const box = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'MultiPoint' as const, coordinates: [[midLon - hLon, midLat - hLat], [midLon + hLon, midLat + hLat]] },
  };
  const proj = geoMercator().fitExtent([[CPAD, CPAD], [CW - CPAD, CH - CPAD]], box).clipExtent([[0, 0], [CW, CH]]);
  const p = geoPath(proj).digits(1);
  const ck = proj.scale();
  const [ctx, cty] = proj.translate();
  // Scale bar: a round number of km close to 1/5 of the width.
  const pxPerKm = (ck / 6371.0088) / Math.cos(rad(midLat));
  const km = [0.5, 1, 2, 5, 10, 20, 50].reduce((best, k) => (Math.abs(k * pxPerKm - CW / 5) < Math.abs(best * pxPerKm - CW / 5) ? k : best));
  cityMaps[c.slug] = {
    w: CW,
    h: CH,
    mercator: { k: round(ck), tx: round(ctx), ty: round(cty) },
    land: p(cityFine.outline as GeoPermissibleObjects) ?? '',
    borders: p(cityFine.borders) ?? '',
    scale: { km, px: round(km * pxPerKm) },
  };
}
writeFileSync(OUT_CITIES, JSON.stringify(cityMaps));
console.log(`city-maps.json: ${Object.keys(cityMaps).length} cities, ${(JSON.stringify(cityMaps).length / 1024).toFixed(1)} KB (${pts.length ? 'framed on real stations' : 'default frames'})`);
