// RSS 路由：/rss/* 生成 RSS XML

import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { getItems, feedItemsToRssXml } from "../../feeder/index.js";
import { queryItems } from "../../db/index.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../../core/channel/index.js";
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

  /** 查询式 RSS：按 channel、search、sourceUrl、author、tags 过滤，返回匹配条目的 XML */
  app.get("/rss", async (c) => {
    const channelId = c.req.query("channel") ?? undefined;
    const search = c.req.query("search") ?? c.req.query("q") ?? undefined;
    const sourceUrl = c.req.query("source") ?? c.req.query("sourceUrl") ?? undefined;
    const author = c.req.query("author") ?? undefined;
    const tagsParam = c.req.query("tags") ?? undefined;
    const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const lng = c.req.query("lng") ?? undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const title = c.req.query("title") ?? undefined;
    const daysParam = c.req.query("days");
    const sinceParam = c.req.query("since") ?? undefined;
    const untilParam = c.req.query("until") ?? undefined;
    let since: Date | undefined;
    let until: Date | undefined;
    if (daysParam) {
      const n = Math.max(1, Math.min(365, Number(daysParam) || 1));
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      since = new Date(todayStart);
      since.setDate(since.getDate() - (n - 1));
      until = todayEnd;
    } else {
      since = sinceParam ? new Date(sinceParam) : undefined;
      if (untilParam) {
        if (untilParam.length === 10) {
          const d = new Date(untilParam + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1);
          until = d;
        } else {
          until = new Date(untilParam);
        }
      }
    }

    let sourceUrls: string[] | undefined;
    if (channelId) {
      const channels = await getAllChannelConfigs();
      const channelRefs =
        channelId === "all" || !channelId
          ? collectAllSourceRefs(channels)
          : (channels.find((x) => x.id === channelId)?.sourceRefs ?? []);
      if (sourceUrl) {
        sourceUrls = channelRefs.filter((s) => s === sourceUrl);
      } else {
        sourceUrls = channelRefs;
      }
    }

    if (sourceUrls?.length === 0) {
      const xml = feedItemsToRssXml([], new URL(c.req.url).href, lng, {
        channelTitle: title ?? "RSS 订阅",
        channelDesc: "无匹配条目",
      });
      return c.body(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8" });
    }

    const result = await queryItems({
      sourceUrl: sourceUrls ? undefined : sourceUrl,
      sourceUrls,
      author,
      q: search,
      tags,
      since,
      until,
      limit,
      offset,
    });
    const feedItems = result.items.map((dbItem) => ({
      guid: dbItem.id,
      title: dbItem.title ?? "",
      link: dbItem.url,
      pubDate: dbItem.pub_date ? new Date(dbItem.pub_date) : new Date(),
      author: dbItem.author ?? undefined,
      summary: dbItem.summary ?? undefined,
      content: dbItem.content ?? undefined,
      tags: dbItem.tags ?? undefined,
      sourceRef: dbItem.source_url,
      translations: dbItem.translations ?? undefined,
    }));

    const rssUrl = new URL(c.req.url);
    const channelTitle = title ?? "RSS 订阅";
    const xml = feedItemsToRssXml(feedItems, rssUrl.href, lng, {
      channelTitle,
      channelDesc: `来自 ${rssUrl.href} 的订阅`,
    });
    return c.body(xml, 200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
    });
  });

  /** 按 URL 抓取式 RSS：/rss/https://... 从信源实时抓取 */
  app.get("/rss/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/rss");
    if (!url) return c.text("无效 URL，格式: /rss/https://... 或 /rss/www.xiaohongshu.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const lng = c.req.query("lng") ?? undefined;
      const httpId = "rss-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
      const { items } = await scheduler.schedule(
        SOURCES_GROUP,
        httpId,
        () => getItems(url, { cacheDir: CACHE_DIR, headless, writeDb: true, lng })
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
