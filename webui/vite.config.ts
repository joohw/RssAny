import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3751',
      '/rss': 'http://127.0.0.1:3751',
      '/parse': { target: 'http://127.0.0.1:3751', bypass: (req) => req.url === '/parse' ? '/parse' : undefined },
      '/extractor': { target: 'http://127.0.0.1:3751', bypass: (req) => req.url === '/extractor' ? '/extractor' : undefined },
      '/subscription': 'http://127.0.0.1:3751',
      '/auth': 'http://127.0.0.1:3751',
    },
  },
});
