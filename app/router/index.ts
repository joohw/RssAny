// App 入口：Hono 服务，与 feeder 解耦；可替换为 Express 等

import "dotenv/config";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRss } from "../feeder/index.js";
import { onFeedUpdated } from "../core/events/index.js";
import { getSourcesRaw, saveSourcesFile } from "../scraper/subscription/index.js";
import type { SourceType } from "../scraper/subscription/types.js";
import type { RefreshInterval } from "../utils/refreshInterval.js";
import { VALID_INTERVALS } from "../utils/refreshInterval.js";
import { initSources as initSites } from "../scraper/sources/index.js";
import { initScheduler } from "../scraper/scheduler/index.js";
import { initUserDir, BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR, CHANNELS_CONFIG_PATH } from "../config/paths.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../core/channel/index.js";
import { extractFromLink } from "../scraper/sources/web/extractor/index.js";
import { ensureAuth, preCheckAuth, getOrCreateBrowser } from "../scraper/sources/web/fetcher/index.js";
import { getWebSite, getBestSite, getPluginSites, toAuthFlow, buildSiteContext } from "../scraper/sources/web/index.js";
import type { FeedItem } from "../types/feedItem.js";
import { getEffectiveItemFields, type ItemTranslationFields } from "../types/feedItem.js";
import { AuthRequiredError, NotFoundError } from "../scraper/auth/index.js";
import { queryItems, queryFeedItems, getPendingPushItems, markPushed, queryLogs } from "../db/index.js";
import { enrichQueue } from "../scraper/enrich/index.js";
import { logger } from "../core/logger/index.js";
import { createMcpHandler } from "../mcp/server.js";


const PORT = Number(process.env.PORT) || 3751;
const IS_DEV = process.env.NODE_ENV === "development" || process.argv.includes("--watch");
const CACHE_DIR = process.env.CACHE_DIR ?? "cache";
const STATICS_DIR = join(process.cwd(), "statics");
const PLUGIN_WATCH_EXTS = [".rssany.js", ".rssany.ts"];


/** 从路径提取 URL（与 /rss/* 一致） */
function parseUrlFromPath(path: string, prefix: string): string | null {
  const raw = path.slice(prefix.length) || "";
  const decoded = decodeURIComponent(raw.startsWith("/") ? raw.slice(1) : raw);
  if (!decoded) return null;
  return decoded.startsWith("http") ? decoded : `https://${decoded}`;
}


/** 读取静态 HTML（statics/ 目录，用于 401/404 错误页） */
async function readStaticHtml(name: string, fallback: string): Promise<string> {
  try {
    return await readFile(join(STATICS_DIR, `${name}.html`), "utf-8");
  } catch {
    return fallback;
  }
}


/** HTML 转义，用于注入到页面中的不可信内容 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


/** 创建 Hono 应用，feeder 通过参数注入便于测试与换框架 */
function createApp(getRssFn: typeof getRss = getRss) {
  const app = new Hono();
  // MCP：Streamable HTTP（SSE），GET 建 SSE / POST 发 JSON-RPC
  app.all("/mcp", async (c) => {
    const handler = await createMcpHandler();
    return handler(c.req.raw);
  });
  // API：以 JSON 格式返回 RSS 条目（供 preview 页面轮询使用）；支持 lng 取译文
  app.get("/api/rss", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "url 参数缺失" }, 400);
    const headlessParam = c.req.query("headless");
    const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
    const lng = c.req.query("lng") ?? undefined;
    try {
      const result = await getRssFn(url, { cacheDir: CACHE_DIR, headless, lng });
      return c.json({
        fromCache: result.fromCache,
        items: result.items.map((item) => {
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
  // API：查询后台正文提取任务状态（进行中 or 已完成）
  app.get("/api/enrich/:taskId", (c) => {
    const taskId = c.req.param("taskId");
    const task = enrichQueue.getTask(taskId);
    if (!task) return c.json({ error: "任务不存在或已过期" }, 404);
    return c.json(task);
  });
  // API：返回插件列表 JSON
  app.get("/api/plugins", (c) => {
    const plugins = getPluginSites().map((s) => ({
      id: s.id,
      listUrlPattern: typeof s.listUrlPattern === "string" ? s.listUrlPattern : String(s.listUrlPattern),
      hasEnrich: !!s.enrichItem,
      hasAuth: !!(s.checkAuth && s.loginUrl),
    }));
    return c.json(plugins);
  });
  // API：查询数据库条目列表（支持 source_url / q 过滤、分页）；支持 lng 取译文
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
  // API：分页查询首页信息流（纯 DB 查询，基于 channels.json，不触发实时抓取）
  app.get("/api/feed", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const channelFilter = c.req.query("channel") ?? c.req.query("sub") ?? undefined;
    const lng = c.req.query("lng") ?? undefined;
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
    const { items: dbItems, hasMore } = await queryFeedItems(sourceRefs, limit, offset);
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
  // SSE：推送后台抓取进度
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
  app.get("/api/logs", async (c) => {
    const levelParam = c.req.query("level");
    const level = levelParam === "error" || levelParam === "warn" || levelParam === "info" || levelParam === "debug" ? levelParam : undefined;
    const categoryParam = c.req.query("category");
    const category = categoryParam && /^(feeder|scheduler|enrich|db|auth|plugin|source|llm|app|config|writer)$/.test(categoryParam) ? categoryParam : undefined;
    const source_url = c.req.query("source_url") ?? undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const sinceParam = c.req.query("since");
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const result = await queryLogs({ level, category: category as import("../core/logger/types.js").LogCategory | undefined, source_url, limit, offset, since });
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
      const sources: { ref: string; type?: SourceType; label?: string; refresh?: RefreshInterval; proxy?: string }[] = list
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
  // 认证
  app.get("/auth/check", async (c) => {
    const siteIdParam = c.req.query("siteId");
    if (!siteIdParam) {
      return c.json({ ok: false, message: "请提供 siteId" }, 400);
    }
    const site = getWebSite(siteIdParam);
    if (!site) return c.json({ ok: false, message: "无此站点" }, 404);
    const authFlow = toAuthFlow(site);
    if (!authFlow) return c.json({ ok: false, message: "该站点无需登录" }, 400);
    try {
      const authenticated = await preCheckAuth(authFlow, CACHE_DIR);
      return c.json({ ok: true, authenticated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, message: `检查失败: ${msg}` }, 500);
    }
  });
  app.post("/auth/open", async (c) => {
    const siteIdParam = c.req.query("siteId");
    if (!siteIdParam) {
      return c.json({ ok: false, message: "请提供 siteId" }, 400);
    }
    const site = getWebSite(siteIdParam);
    if (!site) return c.json({ ok: false, message: "无此站点" }, 404);
    const authFlow = toAuthFlow(site);
    if (!authFlow) return c.json({ ok: false, message: "该站点无需登录" }, 400);
    const { loginUrl } = authFlow;
    getOrCreateBrowser({ headless: false, cacheDir: CACHE_DIR }).then(async (browser) => {
      const page = await browser.newPage();
      const realUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
      await page.setUserAgent(realUserAgent);
      await page.setViewport({ width: 1366, height: 960 });
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    }).catch((err) => {
      logger.warn("auth", "打开登录页面失败", { err: err instanceof Error ? err.message : String(err) });
    });
    return c.json({ ok: true, message: "已打开登录页面" });
  });
  app.post("/auth/ensure", async (c) => {
    const urlParam = c.req.query("url");
    const siteIdParam = c.req.query("siteId");
    let site;
    if (urlParam) {
      const decoded = decodeURIComponent(urlParam);
      site = getBestSite(decoded);
      if (!site) return c.json({ ok: false, message: "无匹配站点" }, 404);
    } else if (siteIdParam) {
      site = getWebSite(siteIdParam);
      if (!site) return c.json({ ok: false, message: "无此站点" }, 404);
    } else {
      return c.json({ ok: false, message: "请提供 url 或 siteId" }, 400);
    }
    const authFlow = toAuthFlow(site);
    if (!authFlow) return c.json({ ok: false, message: "该站点无需登录" }, 400);
    ensureAuth(authFlow, CACHE_DIR).then(() => logger.info("auth", "ensureAuth 完成")).catch((e) => logger.warn("auth", "ensureAuth 失败", { err: e instanceof Error ? e.message : String(e) }));
    return c.json({ ok: true, message: "已打开登录窗口，请在弹出的浏览器中完成登录，完成后刷新订阅页面即可。" });
  });
  async function render401(listUrl: string): Promise<string> {
    const raw = await readStaticHtml("401", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>401</title></head><body><h1>401 需要登录</h1></body></html>");
    return raw.replace(/\{\{listUrl\}\}/g, escapeHtml(listUrl));
  }
  app.get("/parse/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/parse");
    if (!url) return c.text("无效 URL，格式: /parse/https://... 或 /parse/example.com/...", 400);
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
  app.get("/extractor/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/extractor");
    if (!url) return c.text("无效 URL，格式: /extractor/https://... 或 /extractor/example.com/...", 400);
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
  app.get("/rss/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/rss");
    if (!url) return c.text("无效 URL，格式: /rss/https://... 或 /rss/www.xiaohongshu.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const lng = c.req.query("lng") ?? undefined;
      const { xml } = await getRssFn(url, { cacheDir: CACHE_DIR, headless, writeDb: true, lng });
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
    const watcher = watch(dir, { recursive: false }, (eventType, filename) => {
      if (!filename || !PLUGIN_WATCH_EXTS.some((ext) => filename.endsWith(ext))) return;
      if (eventType === "rename" || eventType === "change") debouncedReload();
    });
    watcher.on("error", (err) => {
      logger.warn("plugin", "插件目录监听错误", { dir, err: err.message });
    });
  }
}


async function main() {
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
