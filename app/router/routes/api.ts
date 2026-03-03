// API 路由：server-info、rss、items、feed、sources、channels、enrich、scheduler、plugins、logs、events、admin/verify

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getItems } from "../../feeder/index.js";
import { onFeedUpdated } from "../../core/events/index.js";
import { SOURCES_GROUP } from "../../scraper/scheduler/index.js";
import * as scheduler from "../../scheduler/index.js";
import { getSourcesRaw, saveSourcesFile } from "../../scraper/subscription/index.js";
import type { SourceType } from "../../scraper/subscription/types.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";
import { VALID_INTERVALS } from "../../utils/refreshInterval.js";
import { CACHE_DIR, CHANNELS_CONFIG_PATH } from "../../config/paths.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../../core/channel/index.js";
import { getEffectiveItemFields, type ItemTranslationFields } from "../../types/feedItem.js";
import { AuthRequiredError, NotFoundError } from "../../scraper/auth/index.js";
import { queryItems, queryFeedItems, getPendingPushItems, markPushed, queryLogs } from "../../db/index.js";
import { enrichQueue } from "../../scraper/enrich/index.js";
import { getPluginSites } from "../../scraper/sources/web/index.js";

const PORT = Number(process.env.PORT) || 3751;

export function registerApiRoutes(app: Hono): void {
  app.get("/api/server-info", (c) => {
    const lanIp = Object.values(networkInterfaces())
      .flat()
      .find((iface) => iface?.family === "IPv4" && !iface.internal)?.address;
    const lanUrl = lanIp ? `http://${lanIp}:${PORT}` : null;
    return c.json({ port: PORT, lanUrl });
  });

  app.get("/api/rss", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "url 参数缺失" }, 400);
    const headlessParam = c.req.query("headless");
    const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
    const lng = c.req.query("lng") ?? undefined;
    try {
      const httpId = "http-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
      const { items, fromCache } = await scheduler.enqueueWithResult(
        SOURCES_GROUP,
        httpId,
        () => getItems(url, { cacheDir: CACHE_DIR, headless, lng }),
        {}
      );
      return c.json({
        fromCache,
        items: items.map((item) => {
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

  app.get("/api/enrich/:taskId", (c) => {
    const taskId = c.req.param("taskId");
    const task = enrichQueue.getTask(taskId);
    if (!task) return c.json({ error: "任务不存在或已过期" }, 404);
    return c.json(task);
  });

  app.get("/api/scheduler/stats", (c) => {
    const stats = scheduler.getGroupStats();
    return c.json(stats);
  });

  app.get("/api/plugins", (c) => {
    const plugins = getPluginSites().map((s) => ({
      id: s.id,
      listUrlPattern: typeof s.listUrlPattern === "string" ? s.listUrlPattern : String(s.listUrlPattern),
      hasEnrich: !!s.enrichItem,
      hasAuth: !!(s.checkAuth && s.loginUrl),
    }));
    return c.json(plugins);
  });

  app.get("/api/feed", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const channelFilter = c.req.query("channel") ?? c.req.query("sub") ?? undefined;
    const lng = c.req.query("lng") ?? undefined;
    const since = c.req.query("since");
    const until = c.req.query("until");
    const channels = await getAllChannelConfigs();
    const channelsMeta = channels.map((ch) => ({
      id: ch.id,
      title: ch.title ?? ch.id,
      description: ch.description ?? "",
    }));
    let sourceRefs: string[];
    if (channelFilter && channelFilter !== "all") {
      const ch = channels.find((x) => x.id === channelFilter);
      sourceRefs = ch?.sourceRefs ?? [];
    } else {
      sourceRefs = collectAllSourceRefs(channels);
    }
    const sourceMap = new Map<string, { subId: string; subTitle: string }>();
    for (const ch of channels) {
      const title = ch.title ?? ch.id;
      for (const ref of ch.sourceRefs || []) {
        if (ref) sourceMap.set(ref, { subId: ch.id, subTitle: title });
      }
    }
    const dateOpts = (since || until) ? { since: since ?? undefined, until: until ?? undefined } : undefined;
    const { items: dbItems, hasMore } = await queryFeedItems(sourceRefs, limit, offset, dateOpts);
    const items = dbItems.map((item) => {
      const base = {
        ...item,
        sub_id: sourceMap.get(item.source_url)?.subId ?? "",
        sub_title: sourceMap.get(item.source_url)?.subTitle ?? "",
      };
      if (!lng) return base;
      const view = {
        title: item.title ?? "",
        summary: item.summary ?? "",
        content: item.content ?? "",
        translations: (item as { translations?: Record<string, ItemTranslationFields> }).translations,
      };
      const eff = getEffectiveItemFields(view, lng);
      return { ...base, title: eff.title, summary: eff.summary, content: eff.content };
    });
    return c.json({ channels: channelsMeta, items, hasMore });
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });
      const off = onFeedUpdated((e) => {
        stream.writeSSE({ data: JSON.stringify({ type: "feed:updated", sourceUrl: e.sourceUrl, newCount: e.newCount }) }).catch(() => {});
      });
      const heartbeat = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 25000);
      stream.onAbort(() => {
        off();
        clearInterval(heartbeat);
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });

  app.get("/api/items/pending-push", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const items = await getPendingPushItems(limit);
    return c.json({ items, count: items.length });
  });

  app.post("/api/items/mark-pushed", async (c) => {
    try {
      const { ids } = await c.req.json<{ ids?: string[] }>();
      if (!Array.isArray(ids) || ids.length === 0) return c.json({ ok: false, message: "ids 不能为空" }, 400);
      await markPushed(ids);
      return c.json({ ok: true, count: ids.length });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/items", async (c) => {
    const sourceUrl = c.req.query("source") ?? undefined;
    const q = c.req.query("q") ?? undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const lng = c.req.query("lng") ?? undefined;
    const result = await queryItems({ sourceUrl, q, limit, offset });
    const items =
      lng && result.items.length > 0
        ? result.items.map((it) => {
            const view = {
              title: it.title ?? "",
              summary: it.summary ?? "",
              content: it.content ?? "",
              translations: (it as { translations?: Record<string, ItemTranslationFields> }).translations,
            };
            const eff = getEffectiveItemFields(view, lng);
            return { ...it, title: eff.title, summary: eff.summary, content: eff.content };
          })
        : result.items;
    return c.json({ ...result, items });
  });

  app.get("/api/logs", async (c) => {
    const levelParam = c.req.query("level");
    const level = levelParam === "error" || levelParam === "warn" || levelParam === "info" || levelParam === "debug" ? levelParam : undefined;
    const categoryParam = c.req.query("category");
    const category = categoryParam && /^(feeder|enrich|db|auth|plugin|source|llm|app|config|writer)$/.test(categoryParam) ? categoryParam : undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const sinceParam = c.req.query("since");
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const result = await queryLogs({ level, category: category as import("../../core/logger/types.js").LogCategory | undefined, limit, offset, since });
    return c.json(result);
  });

  app.get("/api/admin/verify", async (c) => {
    return c.json({ ok: true });
  });

  app.get("/api/sources/raw", async (c) => {
    try {
      const raw = await getSourcesRaw();
      return c.text(raw, 200, { "Content-Type": "application/json; charset=utf-8" });
    } catch {
      return c.text(JSON.stringify({ sources: [] }, null, 2), 200, { "Content-Type": "application/json; charset=utf-8" });
    }
  });

  app.put("/api/sources/raw", async (c) => {
    try {
      const body = await c.req.json<{ sources?: unknown[] }>();
      const list = Array.isArray(body?.sources) ? body.sources : [];
      const sources: { ref: string; type?: SourceType; label?: string; description?: string; refresh?: RefreshInterval; proxy?: string }[] = list
        .filter((s): s is Record<string, unknown> => s != null && typeof s === "object" && typeof (s as { ref?: unknown }).ref === "string")
        .map((s) => {
          const t = (s as { type?: string }).type;
          const type: SourceType | undefined =
            t === "web" || t === "rss" || t === "email" ? t : undefined;
          const r = (s as { refresh?: string }).refresh;
          const refresh: RefreshInterval | undefined =
            r && VALID_INTERVALS.includes(r as RefreshInterval) ? (r as RefreshInterval) : undefined;
          return {
            ref: String((s as { ref: string }).ref),
            type,
            label: (s as { label?: string }).label,
            description: (s as { description?: string }).description,
            refresh,
            proxy: (s as { proxy?: string }).proxy,
          };
        });
      await saveSourcesFile(sources);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** 频道列表（供前端 Tab 展示，与 channels/raw 区分：此为结构化列表） */
  app.get("/api/channels", async (c) => {
    const channels = await getAllChannelConfigs();
    const list = channels.map((ch) => ({
      id: ch.id,
      title: ch.title ?? ch.id,
      description: ch.description ?? "",
    }));
    return c.json(list);
  });

  app.get("/api/channels/raw", async (c) => {
    try {
      const raw = await readFile(CHANNELS_CONFIG_PATH, "utf-8");
      return c.text(raw, 200, { "Content-Type": "application/json; charset=utf-8" });
    } catch {
      return c.text("{}", 200, { "Content-Type": "application/json; charset=utf-8" });
    }
  });

  app.put("/api/channels/raw", async (c) => {
    try {
      const raw = await c.req.text();
      JSON.parse(raw);
      await writeFile(CHANNELS_CONFIG_PATH, raw, "utf-8");
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** 按 channel 直接读 feeds，支持 limit/offset/since/until/lng；channelId=all 表示全部 */
  app.get("/api/channels/:channelId/feeds", async (c) => {
    const channelId = c.req.param("channelId");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const lng = c.req.query("lng") ?? undefined;
    const since = c.req.query("since");
    const until = c.req.query("until");
    const channels = await getAllChannelConfigs();
    const sourceMap = new Map<string, { subId: string; subTitle: string }>();
    for (const ch of channels) {
      const title = ch.title ?? ch.id;
      for (const ref of ch.sourceRefs || []) {
        if (ref) sourceMap.set(ref, { subId: ch.id, subTitle: title });
      }
    }
    let sourceRefs: string[];
    if (channelId === "all" || !channelId) {
      sourceRefs = collectAllSourceRefs(channels);
    } else {
      const ch = channels.find((x) => x.id === channelId);
      sourceRefs = ch?.sourceRefs ?? [];
    }
    const dateOpts = (since || until) ? { since: since ?? undefined, until: until ?? undefined } : undefined;
    const { items: dbItems, hasMore } = await queryFeedItems(sourceRefs, limit, offset, dateOpts);
    const items = dbItems.map((item) => {
      const base = {
        ...item,
        sub_id: sourceMap.get(item.source_url)?.subId ?? "",
        sub_title: sourceMap.get(item.source_url)?.subTitle ?? "",
      };
      if (!lng) return base;
      const view = {
        title: item.title ?? "",
        summary: item.summary ?? "",
        content: item.content ?? "",
        translations: (item as { translations?: Record<string, ItemTranslationFields> }).translations,
      };
      const eff = getEffectiveItemFields(view, lng);
      return { ...base, title: eff.title, summary: eff.summary, content: eff.content };
    });
    return c.json({ items, hasMore });
  });
}
