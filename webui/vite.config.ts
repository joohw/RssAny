import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const HONO_PORT = 3751;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // 开发时将 API / 后端路由代理到 Hono
    proxy: {
      '/api': `http://127.0.0.1:${HONO_PORT}`,
      '/auth': `http://127.0.0.1:${HONO_PORT}`,
      '/rss': `http://127.0.0.1:${HONO_PORT}`,
      '/parse': {
        target: `http://127.0.0.1:${HONO_PORT}`,
        // 只代理 /parse/<url> 形式，不代理 /parse 本身（SPA 路由）
        bypass(req) {
          const url = req.url ?? '';
          // /parse 本身由 SPA 处理；/parse/ 开头后面有 URL 路径则代理到 Hono
          if (url === '/parse' || url.startsWith('/parse?')) return url;
          return undefined;
        },
      },
      '/extractor': {
        target: `http://127.0.0.1:${HONO_PORT}`,
        bypass(req) {
          const url = req.url ?? '';
          if (url === '/extractor' || url.startsWith('/extractor?')) return url;
          return undefined;
        },
      },
      '/subscription': `http://127.0.0.1:${HONO_PORT}`,
    },
  },
});
