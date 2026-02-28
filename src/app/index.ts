// App 入口：Hono 服务，与 feeder 解耦；可替换为 Express 等

import "dotenv/config";
import { networkInterfaces } from "node:os";
import { watch } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./router.js";
import { initSources as initSites } from "../scraper/sources/index.js";
import { initScheduler } from "../scraper/scheduler/index.js";
import { initUserDir, BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR } from "../config/paths.js";
import { getAdminToken } from "../config/adminToken.js";
import { logger } from "../core/logger/index.js";


const PORT = Number(process.env.PORT) || 3751;
const IS_DEV = process.env.NODE_ENV === "development" || process.argv.includes("--watch");


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
    const watcher = watch(dir, { recursive: false }, (eventType, filename) => {
      if (!filename || !PLUGIN_WATCH_EXTS.some((ext) => filename.endsWith(ext))) return;
      if (eventType === "rename" || eventType === "change") debouncedReload();
    });
    watcher.on("error", (err) => {
      logger.warn("plugin", "插件目录监听错误", { dir, err: err.message });
    });
  }
}


const PLUGIN_WATCH_EXTS = [".rssany.js", ".rssany.ts"];


async function main() {
  await initUserDir();
  await initSites();
  const CACHE_DIR = process.env.CACHE_DIR ?? "cache";
  await initScheduler(CACHE_DIR);
  const app = createApp();
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(`API 服务已启动 http://127.0.0.1:${PORT}/`);
  const lanIp = Object.values(networkInterfaces()).flat().find((iface) => iface?.family === "IPv4" && !iface.internal)?.address;
  if (lanIp) console.log(`局域网访问 http://${lanIp}:${PORT}/`);
  const adminToken = await getAdminToken();
  console.log(`Admin 入口 token=${adminToken}  http://127.0.0.1:5173/admin`);
  if (IS_DEV) {
    watchPlugins();
  }
}
main();
