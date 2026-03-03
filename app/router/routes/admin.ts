// Admin 路由：解析调试、正文提取调试

import type { Hono } from "hono";
import type { FeedItem } from "../../types/feedItem.js";
import { getBestSite, buildSiteContext } from "../../scraper/sources/web/index.js";
import { extractFromLink } from "../../scraper/sources/web/extractor/index.js";
import { CACHE_DIR } from "../../config/paths.js";
import { AuthRequiredError } from "../../scraper/auth/index.js";
import { parseUrlFromPath, readStaticHtml, escapeHtml } from "../utils.js";

export function registerAdminRoutes(app: Hono): void {
  async function render401(listUrl: string): Promise<string> {
    const raw = await readStaticHtml("401", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>401</title></head><body><h1>401 需要登录</h1></body></html>");
    return raw.replace(/\{\{listUrl\}\}/g, escapeHtml(listUrl));
  }

  app.get("/admin/parse/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/admin/parse");
    if (!url) return c.text("无效 URL，格式: /admin/parse/https://... 或 /admin/parse/example.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const site = getBestSite(url);
      if (!site) {
        return c.text("无匹配插件，且通用解析需通过 /rss/ 路由触发", 404);
      }
      const siteCtx = buildSiteContext(site, { cacheDir: CACHE_DIR, headless });
      const items = await site.fetchItems(url, siteCtx);
      return c.json({ items, url, mode: "plugin", pluginId: site.id });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        const html = await render401(url);
        return c.html(html, 401);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`解析失败: ${msg}`, 500);
    }
  });

  app.get("/admin/extractor/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/admin/extractor");
    if (!url) return c.text("无效 URL，格式: /admin/extractor/https://... 或 /admin/extractor/example.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const site = getBestSite(url);
      if (site?.enrichItem) {
        const siteCtx = buildSiteContext(site, { cacheDir: CACHE_DIR, headless });
        const stub: FeedItem = { guid: url, title: "", link: url, pubDate: new Date() };
        const enriched = await site.enrichItem(stub, siteCtx);
        return c.json({
          title: enriched.title ?? null,
          author: enriched.author ?? null,
          pubDate: enriched.pubDate instanceof Date ? enriched.pubDate.toISOString() : (enriched.pubDate ?? null),
          content: enriched.content ?? null,
          _extractor: site.id,
        });
      }
      const proxy = site?.proxy;
      const result = await extractFromLink(url, {}, { timeoutMs: 60_000, headless, proxy });
      return c.json({
        title: result.title ?? null,
        author: result.author ?? null,
        pubDate: result.pubDate ?? null,
        content: result.content ?? null,
        _extractor: "readability",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`提取失败: ${msg}`, 500);
    }
  });
}
