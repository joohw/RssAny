// Router：Hono 实现，与 feeder 解耦，仅负责 HTTP 层

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { getRss } from "../feeder/index.js";
import { getSubscription, listSubscriptions, getAllSubscriptionConfigs, createOrUpdateSubscription, deleteSubscription } from "../subscription/index.js";
import { extractFromLink } from "../extractor/index.js";
import { parseHtml } from "../parser/index.js";
import { fetchHtml, ensureAuth, preCheckAuth, getOrCreateBrowser } from "../fetcher/index.js";
import { getSite, getSiteById, getSiteForExtraction, toAuthFlow, registeredSites, getProxy, getSiteConfigEntries, upsertSiteConfigEntry, deleteSiteConfigEntry } from "../sites/index.js";
import { AuthRequiredError, NotFoundError } from "../auth/index.js";
import { queryItems, getPendingPushItems, markPushed } from "../db/index.js";


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
  // API：获取所有站点配置
  app.get("/api/sites", (c) => {
    const list = getSiteConfigEntries().map(([pattern, , cfg]) => ({ pattern, ...cfg }));
    return c.json(list);
  });
  // API：新增或更新站点配置
  app.post("/api/sites", async (c) => {
    try {
      const body = await c.req.json<{ pattern?: string; proxy?: string; refresh?: string }>();
      if (!body.pattern?.trim()) return c.json({ ok: false, message: "pattern 不能为空" }, 400);
      await upsertSiteConfigEntry(body.pattern.trim(), { proxy: body.proxy || undefined, refresh: body.refresh as never || undefined });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  // API：删除站点配置（body 中传 pattern）
  app.delete("/api/sites", async (c) => {
    try {
      const body = await c.req.json<{ pattern?: string }>();
      if (!body.pattern) return c.json({ ok: false, message: "pattern 不能为空" }, 400);
      const deleted = await deleteSiteConfigEntry(body.pattern);
      return c.json({ ok: deleted, message: deleted ? undefined : "未找到该配置" });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
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
    const plugins = registeredSites.filter((s) => s.id !== "generic").map((s) => ({
      id: s.id,
      listUrlPattern: typeof s.listUrlPattern === "string" ? s.listUrlPattern : String(s.listUrlPattern),
      hasParser: !!s.parser,
      hasExtractor: !!s.extractor,
      hasAuth: !!(s.checkAuth && s.loginUrl),
    }));
    return c.json(plugins);
  });
  // 获取所有订阅完整配置（管理页面用）
  app.get("/api/subscription", async (c) => {
    const configs = await getAllSubscriptionConfigs();
    return c.json(configs);
  });
  // 创建或更新订阅（body 含 id 字段时视为创建，否则用 :id 参数）
  app.post("/api/subscription", async (c) => {
    try {
      const body = await c.req.json() as { id?: string; title?: string; description?: string; sources?: unknown[]; maxItemsPerSource?: number; refreshIntervalMs?: number };
      const { id, ...config } = body;
      if (!id || typeof id !== "string" || !Array.isArray(config.sources)) return c.json({ ok: false, message: "缺少必要字段 id / sources" }, 400);
      await createOrUpdateSubscription(id, config as Parameters<typeof createOrUpdateSubscription>[1]);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  // 更新指定订阅配置
  app.put("/api/subscription/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const config = await c.req.json() as Parameters<typeof createOrUpdateSubscription>[1];
      if (!Array.isArray(config.sources)) return c.json({ ok: false, message: "缺少必要字段 sources" }, 400);
      await createOrUpdateSubscription(id, config);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  // 删除指定订阅
  app.delete("/api/subscription/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const deleted = await deleteSubscription(id);
      if (!deleted) return c.json({ ok: false, message: "订阅不存在" }, 404);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  // 检查登录状态
  app.get("/auth/check", async (c) => {
    const siteIdParam = c.req.query("siteId");
    if (!siteIdParam) {
      return c.json({ ok: false, message: "请提供 siteId" }, 400);
    }
    const site = getSiteById(siteIdParam);
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
    const site = getSiteById(siteIdParam);
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
      site = getSite(decoded);
      if (!site) return c.json({ ok: false, message: "无匹配站点" }, 404);
    } else if (siteIdParam) {
      site = getSiteById(siteIdParam);
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
      const site = getSite(url);
      if (!site) return c.text("无匹配站点", 404);
      const authFlow = toAuthFlow(site);
      const proxy = getProxy(url);
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
        customParser: site.parser ?? undefined,
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
      const site = getSiteForExtraction(url) ?? getSite(url);
      const proxy = getProxy(url);
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
    const html = await readStaticHtml("home", "<h1>RssAny</h1>");
    return c.html(html);
  });
  app.get("/sites", async (c) => {
    const html = await readStaticHtml("sites", "<h1>Sites</h1>");
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
  app.get("/subscriptions", async (c) => {
    const html = await readStaticHtml("subscription", "<h1>Subscriptions</h1>");
    return c.html(html);
  });
  // 静态文件服务：statics/ 目录（直接访问 .html 文件等）
  app.use("/*", serveStatic({ root: "./statics" }));
  return app;
}
