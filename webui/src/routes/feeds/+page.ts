import { redirect } from '@sveltejs/kit';

export function load({ url }: { url: URL }) {
  const params = url.searchParams;
  const hasChannel = params.has('channel');
  if (!hasChannel) {
    const next = new URLSearchParams(params);
    next.set('channel', 'all');
    throw redirect(302, '/feeds?' + next.toString());
  }
  return {};
}
