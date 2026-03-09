import { redirect } from '@sveltejs/kit';

/** 兼容旧路由：/tags → /topics */
export function load() {
  throw redirect(302, '/topics');
}
