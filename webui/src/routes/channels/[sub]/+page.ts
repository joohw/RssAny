import { redirect } from '@sveltejs/kit';

export function load({ params, url }) {
  const sub = params.sub ?? 'all';
  const days = url.searchParams.get('days');
  const target = days ? `/feeds?channel=${encodeURIComponent(sub)}&days=${days}` : `/feeds?channel=${encodeURIComponent(sub)}`;
  throw redirect(302, target);
}
