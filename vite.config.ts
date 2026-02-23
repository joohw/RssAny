import { defineConfig } from "vite";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{js,ts}"],
  },
  build: {
    target: "node20",
    ssr: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    outDir: "dist",
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [/^node:/, "stream", "http", "http2", "https", "path", "fs", "crypto", "os", "url", "util", "assert", "@hono/node-server"],
      output: {
        preserveModules: false,
        entryFileNames: "[name].js",
      },
    },
  }
});
