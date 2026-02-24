// Router：Hono 实现，与 feeder 解耦，仅负责 HTTP 层

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { getRss } from "../feeder/index.js";
import { onFeedUpdated } from "../events/index.js";
import { getSubscription, listSubscriptions, getAllSubscriptionConfigs } from "../subscription/index.js";
import { resolveRef } from "../subscription/types.js";
import { extractFromLink } from "../sources/web/extractor/index.js";
import { parseHtml } from "../sources/web/parser/index.js";
import { fetchHtml, ensureAuth, preCheckAuth, getOrCreateBrowser } from "../sources/web/fetcher/index.js";
import { getWebSite, getSiteForDetail, getBestSite, getPluginSites, toAuthFlow } from "../sources/web/index.js";
import { AuthRequiredError, NotFoundError } from "../auth/index.js";
import { queryItems, queryItemsBySource, getPendingPushItems, markPushed } from "../db/index.js";
import { refreshIntervalToMs } from "../utils/refreshInterval.js";


const CACHE_DIR = process.env.CACHE_DIR ?? "cache";
const STATICS_DIR = join(process.cwd(), "statics");


/** 从路径提取 URL（与 /rss/* 一致） */
function parseUrlFromPath(path: string, prefix: string): string | null {
  const raw = path.slice(prefix.length) || "";
  const decoded = decodeURIComponent(raw.startsWith("/") ? raw.slice(1) : raw);
  if (!decoded) return null;
  return decoded.startsWith("http") ? decoded : `https://${decoded}`;
}


/** 读取静态 HTML，失败则返回默认文本 */
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
export function createApp(getRssFn: typeof getRss = getRss) {
  const app = new Hono();
  // API：以 JSON 格式返回 RSS 条目（供 preview 页面轮询使用）
  app.get("/api/rss", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ error: "url 参数缺失" }, 400);
    const headlessParam = c.req.query("headless");
    const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
    try {
      const result = await getRssFn(url, { cacheDir: CACHE_DIR, headless });
      return c.json({
        fromCache: result.fromCache,
        items: result.items.map((item) => ({
          ...item,
          pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : item.pubDate,
        })),
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) return c.json({ error: "需要登录", code: "AUTH_REQUIRED" }, 401);
      if (err instanceof NotFoundError) return c.json({ error: err.message, code: "NOT_FOUND" }, 404);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  // API：查询数据库条目列表（支持 source_url / q 过滤、分页）
  app.get("/api/items", async (c) => {
    const sourceUrl = c.req.query("source") ?? undefined;
    const q = c.req.query("q") ?? undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const result = await queryItems({ sourceUrl, q, limit, offset });
    return c.json(result);
  });
  // API：从数据库读取所有订阅的条目，纯 DB 查询，不触发任何实时抓取
  app.get("/api/feed", async (c) => {
    const subs = await getAllSubscriptionConfigs();
    const results = await Promise.all(
      subs.map(async (sub) => {
        const maxPerSource = sub.maxItemsPerSource ?? 50;
        const itemsPerSource = await Promise.all(
          sub.sources.map((src) => {
            const since = src.refresh ? new Date(Date.now() - refreshIntervalToMs(src.refresh)) : undefined;
            return queryItemsBySource(resolveRef(src), maxPerSource, since);
          })
        );
        const items = itemsPerSource.flat().sort((a, b) => {
          const ta = new Date(a.pub_date ?? a.fetched_at).getTime();
          const tb = new Date(b.pub_date ?? b.fetched_at).getTime();
          return tb - ta;
        });
        return { id: sub.id, title: sub.title, items };
      })
    );
    return c.json({ subscriptions: results });
  });
  // SSE：推送后台抓取进度，客户端通过 EventSource 实时感知新条目
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
  // API：获取待推送给 OpenWebUI 的条目（content 不为空且未推送）
  app.get("/api/items/pending-push", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const items = await getPendingPushItems(limit);
    return c.json({ items, count: items.length });
  });
  // API：标记条目已推送（body: { ids: string[] }）
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
  // API：返回插件列表 JSON
  app.get("/api/plugins", (c) => {
    const plugins = getPluginSites().map((s) => ({
      id: s.id,
      listUrlPattern: typeof s.listUrlPattern === "string" ? s.listUrlPattern : String(s.listUrlPattern),
      hasParser: !!s.parser,
      hasExtractor: !!s.extractor,
      hasAuth: !!(s.checkAuth && s.loginUrl),
    }));
    return c.json(plugins);
  });
  // 检查登录状态
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
  // 打开登录页面：复用浏览器单例（若无头则切换为有头），新开 Tab 导航到登录页
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
      console.warn("[Auth] 打开登录页面失败:", err instanceof Error ? err.message : String(err));
    });
    return c.json({ ok: true, message: "已打开登录页面" });
  });
  /** 触发有头浏览器登录：支持 url= 或 siteId=，后台执行 ensureAuth，立即返回 */
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
    ensureAuth(authFlow, CACHE_DIR).then(() => console.log("[Auth] ensureAuth 完成")).catch((e) => console.warn("[Auth] ensureAuth 失败", e));
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
      const authFlow = site ? toAuthFlow(site) : undefined;
      const proxy = site?.proxy;
      const res = await fetchHtml(url, {
        cacheDir: CACHE_DIR,
        useCache: false,
        authFlow,
        timeoutMs: 60_000,
        headless,
        proxy,
      });
      if (res.status !== 200) {
        return c.text(`拉取失败: ${res.status} ${res.statusText}`, 500);
      }
      const result = await parseHtml(res.body, {
        url: res.finalUrl ?? url,
        customParser: site?.parser ?? undefined,
        cacheDir: CACHE_DIR,
        useCache: false,
      });
      return c.json(result);
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
    const path = c.req.path;
    const url = parseUrlFromPath(path, "/extractor");
    if (!url) return c.text("无效 URL，格式: /extractor/https://... 或 /extractor/example.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const site = getSiteForDetail(url) ?? getBestSite(url);
      const proxy = site?.proxy;
      const result = await extractFromLink(url, {
        customExtractor: site?.extractor ?? undefined,
        cacheDir: CACHE_DIR,
        useCache: false,
      }, {
        timeoutMs: 60_000,
        headless,
        proxy,
      });
      return c.json({
        ...result,
        author: result.author ?? null,
        pubDate: result.pubDate ?? null,
        title: result.title ?? null,
        content: result.content ?? null,
        _extractor: site?.id ?? "readability",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`提取失败: ${msg}`, 500);
    }
  });
  // 列出所有订阅
  app.get("/subscription", async (c) => {
    const list = await listSubscriptions();
    return c.json(list);
  });
  // 获取指定订阅的聚合条目（JSON，服务于数据库/程序消费）
  app.get("/subscription/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await getSubscription(id, CACHE_DIR);
      if (!result) return c.json({ error: `订阅 "${id}" 不存在，请检查 subscriptions.json` }, 404);
      return c.json(result);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return c.json({ error: "需要登录", detail: err.message }, 401);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `拉取订阅失败: ${msg}` }, 500);
    }
  });
  app.get("/rss/*", async (c) => {
    const url = parseUrlFromPath(c.req.path, "/rss");
    if (!url) return c.text("无效 URL，格式: /rss/https://... 或 /rss/www.xiaohongshu.com/...", 400);
    try {
      const headlessParam = c.req.query("headless");
      const headless = headlessParam === "false" || headlessParam === "0" ? false : undefined;
      const { xml } = await getRssFn(url, { cacheDir: CACHE_DIR, headless });
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
  // 页面路由：从 statics/ 目录提供静态 HTML 页面
  app.get("/", async (c) => {
    const html = await readStaticHtml("feed", "<h1>Feed</h1>");
    return c.html(html);
  });
  app.get("/web2rss", async (c) => {
    const html = await readStaticHtml("home", "<h1>Web2RSS</h1>");
    return c.html(html);
  });
  app.get("/plugins", async (c) => {
    const html = await readStaticHtml("plugins", "<h1>Plugins</h1>");
    return c.html(html);
  });
  app.get("/preview", async (c) => {
    const html = await readStaticHtml("preview", "<h1>Preview</h1>");
    return c.html(html);
  });
  app.get("/feed", async (c) => {
    const html = await readStaticHtml("feed", "<h1>Feed</h1>");
    return c.html(html);
  });
  app.get("/parse", async (c) => {
    const html = await readStaticHtml("parse", "<h1>Parse</h1>");
    return c.html(html);
  });
  app.get("/extractor", async (c) => {
    const html = await readStaticHtml("extract", "<h1>Extractor</h1>");
    return c.html(html);
  });
  // 静态文件服务：statics/ 目录（直接访问 .html 文件等）
  app.use("/*", serveStatic({ root: "./statics" }));
  return app;
}
