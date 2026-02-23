// App 入口：Hono 服务，与 feeder 解耦；可替换为 Express 等

import "dotenv/config";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./router.js";
import { initSites } from "../sites/index.js";


const PORT = Number(process.env.PORT) || 3751;
const TUNNEL_ENABLED = process.env.TUNNEL !== "0" && process.env.TUNNEL !== "false";
const IS_DEV = process.env.NODE_ENV === "development" || process.argv.includes("--watch");


/** 启动 Cloudflare 隧道，解析公网 URL 并打印 */
function startCloudflareTunnel(): void {
  const proc = spawn("cloudflared", ["tunnel", "--protocol", "http2", "--url", `http://127.0.0.1:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      console.log(`Cloudflare 公网: ${m[0]}/`);
      proc.stdout?.removeListener("data", onData);
      proc.stderr?.removeListener("data", onData);
    }
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn("未找到 cloudflared，跳过隧道。安装: brew install cloudflared");
    } else {
      console.warn("Cloudflare 隧道启动失败:", err.message);
    }
  });
  proc.on("exit", (code) => {
    if (code != null && code !== 0) console.warn("cloudflared 退出:", code);
  });
}


/** 开发模式：监听插件文件变化并重新加载（防抖 300ms） */
function watchPlugins(): void {
  const pluginsDir = join(process.cwd(), "plugins");
  let reloadTimer: NodeJS.Timeout | null = null;
  const debouncedReload = async () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        await initSites();
      } catch (err) {
        console.error(`[Dev] 插件重新加载失败:`, err instanceof Error ? err.message : String(err));
      }
    }, 300);
  };
  const watcher = watch(
    pluginsDir,
    { recursive: false },
    (eventType, filename) => {
      if (!filename || !filename.endsWith(".rssany.js")) return;
      if (eventType === "rename" || eventType === "change") {
        debouncedReload();
      }
    }
  );
  watcher.on("error", (err) => {
    console.warn(`[Dev] 插件监听错误:`, err.message);
  });
}


async function main() {
  await initSites();
  const app = createApp();
  serve({ fetch: app.fetch, port: PORT });
  console.log(`RssAny: http://127.0.0.1:${PORT}/`);
  if (IS_DEV) {
    watchPlugins();
  }
  if (TUNNEL_ENABLED) startCloudflareTunnel();
}
main();
