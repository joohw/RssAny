import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      // 生成 200.html 作为 SPA fallback（Hono 对未匹配路由返回此文件）
      fallback: '200.html',
      pages: 'build',
      assets: 'build',
    }),
  },
};

export default config;
