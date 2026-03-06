import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const HONO_PORT = 3751;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: true,
    // 开发时将 API / 后端路由代理到 Hono
    proxy: {
      '/api': `http://127.0.0.1:${HONO_PORT}`,
      '/auth': `http://127.0.0.1:${HONO_PORT}`,
      '/rss': `http://127.0.0.1:${HONO_PORT}`,
      '/mcp': `http://127.0.0.1:${HONO_PORT}`,
      '/admin/parse': {
        target: `http://127.0.0.1:${HONO_PORT}`,
        bypass(req) {
          const url = req.url ?? '';
          if (url === '/admin/parse' || url.startsWith('/admin/parse?')) return url;
          return undefined;
        },
      },
      '/admin/extractor': {
        target: `http://127.0.0.1:${HONO_PORT}`,
        bypass(req) {
          const url = req.url ?? '';
          if (url === '/admin/extractor' || url.startsWith('/admin/extractor?')) return url;
          return undefined;
        },
      },
      '/subscription': `http://127.0.0.1:${HONO_PORT}`,
    },
  },
});
