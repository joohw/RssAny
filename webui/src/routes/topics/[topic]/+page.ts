import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** 旧路由：话题详情 → Agent 任务 */
export const load: PageLoad = ({ params }) => {
  const t = params.topic ?? '';
  throw redirect(302, `/agent-tasks/${encodeURIComponent(t)}`);
};
