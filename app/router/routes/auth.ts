// 认证路由：登录检查、打开登录页、ensureAuth

import type { Hono } from "hono";
import { getWebSite, getBestSite, toAuthFlow } from "../../scraper/sources/web/index.js";
import { ensureAuth, preCheckAuth, getOrCreateBrowser } from "../../scraper/sources/web/fetcher/index.js";
import { CACHE_DIR } from "../../config/paths.js";
import { logger } from "../../core/logger/index.js";

export function registerAuthRoutes(app: Hono): void {
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
}
