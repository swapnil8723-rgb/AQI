import indiaMap from '../data/india-map.json';

export interface Mercator {
  k: number;
  tx: number;
  ty: number;
}

/** d3.geoMercator with the pre-computed scale and translate (scripts/build-map.ts). */
export function mercator(m: Mercator, lat: number, lon: number): [number, number] {
  const λ = (lon * Math.PI) / 180;
  const φ = (lat * Math.PI) / 180;
  return [m.tx + m.k * λ, m.ty - m.k * Math.log(Math.tan(Math.PI / 4 + φ / 2))];
}

export const INDIA = indiaMap;

export function projectIndia(lat: number, lon: number): [number, number] {
  return mercator(INDIA.mercator, lat, lon);
}

/** NCR inset coordinates (its own 2r × 2r frame, zoomed 4×). */
export function projectNcr(lat: number, lon: number): [number, number] {
  const { ncr, mercator: m } = INDIA;
  return mercator({ k: m.k * ncr.zoom, tx: ncr.ix, ty: ncr.iy }, lat, lon);
}

export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
