import { redirect } from '@sveltejs/kit';

export function load({ params }) {
  const sub = params.sub || 'all';
  throw redirect(302, '/channels/' + sub);
}
