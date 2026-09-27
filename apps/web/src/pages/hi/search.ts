import type { APIRoute } from 'astro';
import { findCity } from '../../lib/search.ts';

export const GET: APIRoute = ({ url, redirect }) => {
  const slug = findCity(url.searchParams.get('q') ?? '');
  return redirect(slug ? `/hi/aqi/${slug}` : '/hi#near', 302);
};
