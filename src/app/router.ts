// Router：Hono 实现，与 feeder 解耦，仅负责 HTTP 层

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getRss } from "../feeder/index.js";
import { extractFromLink } from "../extractor/index.js";
import { parseHtml } from "../parser/index.js";
import { fetchHtml, ensureAuth, preCheckAuth } from "../fetcher/index.js";
import puppeteer from "puppeteer";
import { getSite, getSiteById, getSiteForExtraction, toAuthFlow, registeredSites, getProxyForSite, getProxyForUrl } from "../sites/index.js";
import { AuthRequiredError, NotFoundError } from "../auth/index.js";


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
  app.get("/", async (c) => {
    const html = await readStaticHtml("home", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>RssAny</title></head><body><h1>RssAny</h1><p>statics/home.html 未找到</p></body></html>");
    return c.html(html);
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
  // 插件管理页面
  app.get("/plugins", async (c) => {
    const html = await readStaticHtml("plugins", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>插件管理 - RssAny</title></head><body><h1>插件管理</h1><p>statics/plugins.html 未找到</p></body></html>");
    return c.html(html);
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
  // 打开登录页面（不绑定检查hook，不管生命周期）
  app.post("/auth/open", async (c) => {
    const siteIdParam = c.req.query("siteId");
    if (!siteIdParam) {
      return c.json({ ok: false, message: "请提供 siteId" }, 400);
    }
    const site = getSiteById(siteIdParam);
    if (!site) return c.json({ ok: false, message: "无此站点" }, 404);
    const authFlow = toAuthFlow(site);
    if (!authFlow) return c.json({ ok: false, message: "该站点无需登录" }, 400);
    const { loginUrl, domain } = authFlow;
    const safeDomain = domain ? domain.replace(/[/\\:]/g, "_") : "default";
    const userDataDir = join(CACHE_DIR, "browser_data", safeDomain);
    const isHeadless = false;
    const launchArgs = [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1366,960",
    ];
    puppeteer.launch({ headless: isHeadless, args: launchArgs, userDataDir }).then(async (browser) => {
      const page = await browser.pages().then((p) => p[0] ?? browser.newPage());
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
      const proxy = getProxyForSite(site.id, url);
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
      const proxy = site ? getProxyForSite(site.id, url) : getProxyForUrl(url);
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
  return app;
}
