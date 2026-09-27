/** /search?q= — the zero-JS search: redirects to the best matching city page. */
import type { APIRoute } from 'astro';
import { findCity } from '../lib/search.ts';

export const GET: APIRoute = ({ url, redirect }) => {
  const slug = findCity(url.searchParams.get('q') ?? '');
  return redirect(slug ? `/aqi/${slug}` : '/#near', 302);
};
