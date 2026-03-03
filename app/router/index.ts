// App 入口：Hono 服务，与 feeder 解耦；可替换为 Express 等

import "dotenv/config";
import { watch } from "node:fs";
import { networkInterfaces } from "node:os";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initSources as initSites } from "../scraper/sources/index.js";
import { initScheduler } from "../scraper/scheduler/index.js";
import { initUserDir, BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR, CACHE_DIR } from "../config/paths.js";
import { logger } from "../core/logger/index.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerRssRoutes } from "./routes/rss.js";

const PORT = Number(process.env.PORT) || 3751;
const IS_DEV = process.env.NODE_ENV === "development" || process.argv.includes("--watch");
const PLUGIN_WATCH_EXTS = [".rssany.js", ".rssany.ts"];

/** 创建 Hono 应用 */
function createApp(): Hono {
  const app = new Hono();

  registerMcpRoutes(app);
  registerChatRoutes(app);
  registerApiRoutes(app);
  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerRssRoutes(app);

  return app;
}

/** 开发模式：监听内置与用户插件目录变化并自动重载（防抖 300ms） */
function watchPlugins(): void {
  let reloadTimer: NodeJS.Timeout | null = null;
  const debouncedReload = async () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        await initSites();
      } catch (err) {
        logger.error("plugin", "插件重新加载失败", { err: err instanceof Error ? err.message : String(err) });
      }
    }, 300);
  };
  for (const dir of [BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR]) {
    const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename || !PLUGIN_WATCH_EXTS.some((ext) => filename.endsWith(ext))) return;
      if (eventType === "rename" || eventType === "change") debouncedReload();
    });
    watcher.on("error", (err) => {
      logger.warn("plugin", "插件目录监听错误", { dir, err: err.message });
    });
  }
}

async function main(): Promise<void> {
  await initUserDir();
  await initSites();
  await initScheduler(CACHE_DIR);
  const app = createApp();
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(`API 服务已启动 http://127.0.0.1:${PORT}/`);
  const lanIp = Object.values(networkInterfaces()).flat().find((iface) => iface?.family === "IPv4" && !iface.internal)?.address;
  if (lanIp) console.log(`局域网访问 http://${lanIp}:${PORT}/`);
  if (IS_DEV) {
    watchPlugins();
  }
}
main();
