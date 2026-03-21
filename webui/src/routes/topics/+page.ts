import { redirect } from '@sveltejs/kit';

/** 旧路由：/topics → 项目文件夹浏览 */
export function load() {
  throw redirect(302, '/folders');
}
