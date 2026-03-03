// RSS 路由：/rss/* 生成 RSS XML

import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { getItems, feedItemsToRssXml } from "../../feeder/index.js";
import { SOURCES_GROUP } from "../../scraper/scheduler/index.js";
import * as scheduler from "../../scheduler/index.js";
import { CACHE_DIR } from "../../config/paths.js";
import { AuthRequiredError, NotFoundError } from "../../scraper/auth/index.js";
import { parseUrlFromPath, readStaticHtml, escapeHtml } from "../utils.js";

export function registerRssRoutes(app: Hono): void {
  async function render401(listUrl: string): Promise<string> {
    const raw = await readStaticHtml("401", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>401</title></head><body><h1>401 需要登录</h1></body></html>");
    return raw.replace(/\{\{listUrl\}\}/g, escapeHtml(listUrl));
  }

  app.get("/rss/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/rss");
    if (!url) return c.text("无效 URL，格式: /rss/https://... 或 /rss/www.xiaohongshu.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const lng = c.req.query("lng") ?? undefined;
      const httpId = "rss-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
      const { items } = await scheduler.enqueueWithResult(
        SOURCES_GROUP,
        httpId,
        () => getItems(url, { cacheDir: CACHE_DIR, headless, writeDb: true, lng }),
        {}
      );
      const xml = feedItemsToRssXml(items, url, lng);
      return c.body(xml, 200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        const html = await render401(url);
        return c.html(html, 401);
      }
      if (err instanceof NotFoundError) {
        const html = await readStaticHtml("404", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>404</title></head><body><h1>404 未找到</h1></body></html>");
        return c.html(html, 404);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`生成 RSS 失败: ${msg}`, 500);
    }
  });
}
