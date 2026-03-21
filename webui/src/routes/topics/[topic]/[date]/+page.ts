import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  throw redirect(
    302,
    `/agent-tasks/${encodeURIComponent(params.topic ?? '')}/${encodeURIComponent(params.date ?? '')}`,
  );
};
