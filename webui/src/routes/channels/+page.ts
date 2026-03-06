import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  const days = url.searchParams.get('days');
  const target = days ? `/feeds?channel=all&days=${days}` : '/feeds?channel=all';
  throw redirect(302, target);
}
