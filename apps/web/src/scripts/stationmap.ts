/** City station maps: zoom and pan; AQI numbers inside the pins once zoomed; a live scale bar. */
import { attachZoom } from './zoom.ts';

document.querySelectorAll<HTMLElement>('[data-map][data-city-map]').forEach((root) => {
  const km = Number(root.dataset.km ?? '0');
  const unit = root.dataset.kmUnit ?? 'km';
  const label = root.querySelector<HTMLElement>('[data-km-label]');
  const nice = (x: number) => (x >= 10 ? Math.round(x) : x >= 1 ? Math.round(x * 2) / 2 : Math.round(x * 10) / 10);
  attachZoom(root, (v) => {
    root.toggleAttribute('data-deeper', v.k >= 1.6);
    // The bar keeps its length on screen, so the distance it stands for shrinks as you zoom in.
    if (label && km) label.textContent = `${nice(km / v.k)} ${unit}`;
  }, 10);
});
