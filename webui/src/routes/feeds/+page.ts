import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  const params = url.searchParams;
  const hasAny = params.has('channel') || params.has('url') || params.has('sourceUrl') || params.has('author') || params.has('search') || params.has('q') || params.has('tags');
  if (!hasAny) {
    const days = params.get('days');
    const suffix = days ? `&days=${days}` : '';
    throw redirect(302, '/feeds?channel=all' + suffix);
  }
  return {};
}
