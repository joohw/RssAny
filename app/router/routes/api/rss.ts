// /api/rss（JSON，按 URL 抓取返回条目列表）

import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { getItems } from "../../../feeder/index.js";
import { SOURCES_GROUP } from "../../../scraper/scheduler/index.js";
import * as scheduler from "../../../scheduler/index.js";
import { CACHE_DIR } from "../../../config/paths.js";
import { AuthRequiredError, NotFoundError } from "../../../scraper/auth/index.js";
import { getEffectiveItemFields } from "../../../types/feedItem.js";

export function registerRssApiRoutes(app: Hono): void {
  app.get("/api/rss", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "url 参数缺失" }, 400);
    const headlessParam = c.req.query("headless");
    const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
    const lng = c.req.query("lng") ?? undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    try {
      const httpId = "http-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
      const { items: allItems, fromCache } = await scheduler.schedule(
        SOURCES_GROUP,
        httpId,
        () => getItems(url, { cacheDir: CACHE_DIR, headless, lng })
      );
      const total = allItems.length;
      const pageItems = allItems.slice(offset, offset + limit);
      return c.json({
        fromCache,
        total,
        hasMore: offset + pageItems.length < total,
        items: pageItems.map((item) => {
          const { title, summary } = lng ? getEffectiveItemFields(item, lng) : { title: item.title, summary: item.summary ?? "" };
          return {
            guid: item.guid,
            title,
            link: item.link,
            summary,
            author: item.author,
            pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : item.pubDate,
          };
        }),
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) return c.json({ error: "需要登录", code: "AUTH_REQUIRED" }, 401);
      if (err instanceof NotFoundError) return c.json({ error: err.message, code: "NOT_FOUND" }, 404);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
