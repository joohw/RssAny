import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  const today = url.searchParams.get('today');
  const target = today === '1' ? '/channels/all?today=1' : '/channels/all';
  throw redirect(302, target);
}
