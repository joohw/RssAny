// 使用无头浏览器（Puppeteer）拉取页面，缓存逻辑在 cacher 中

import { join } from "node:path";
import puppeteer, { type Browser, type Cookie, type Page } from "puppeteer";
import { readCached, writeCached } from "../cacher/index.js";
import { applyPurify } from "./purify.js";
import type { AuthFlow } from "../auth/index.js";
import type { RequestConfig, StructuredHtmlResult } from "./types.js";


/** 解析代理：优先 config.proxy，否则从 HTTP_PROXY/HTTPS_PROXY 读取 */
function resolveProxy(config?: { proxy?: string }): string | undefined {
  return config?.proxy ?? process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY;
}


/** 从代理字符串解析出 serverUrl（供 Chrome --proxy-server）和可选的账号密码（供 407 认证）；支持 http://user:pass@host:port */
function parseProxy(proxy: string): { serverUrl: string; username?: string; password?: string } {
  const u = new URL(proxy);
  const serverUrl = u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
  const username = u.username || undefined;
  const password = u.password || undefined;
  return { serverUrl, username, password };
}


/** 构建 Puppeteer launch args，含可选的 proxy 和 headless 模式；代理带账号密码时仅传 serverUrl，认证在 page 上通过 authenticate 完成 */
function launchArgs(config?: { proxy?: string; headless?: boolean }): string[] {
  const base = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-infobars",
  ];
  // headless 模式下使用更高的窗口高度，有助于首次加载；headful 模式下使用较小高度便于观察
  const height = config?.headless !== false ? 5000 : 960;
  base.push(`--window-size=1366,${height}`);
  const proxy = resolveProxy(config);
  if (proxy) {
    const { serverUrl } = parseProxy(proxy);
    base.push(`--proxy-server=${serverUrl}`);
  }
  return base;
}


/** 获取 userDataDir 路径：基于 cacheDir 和 domain，为每个域名创建独立的用户数据目录以实现隔离 */
function getUserDataDir(cacheDir?: string, domain?: string): string | undefined {
  if (!cacheDir) return undefined;
  if (domain) {
    // 使用 domain 作为目录名，实现域名隔离
    const safeDomain = domain.replace(/[/\\:]/g, "_");
    return join(cacheDir, "browser_data", safeDomain);
  }
  // 如果没有 domain，使用默认目录（用于不需要认证的场景）
  return join(cacheDir, "browser_data", "default");
}


// 注入脚本隐藏自动化特征和广告屏蔽检测
async function stealthPage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    /* global navigator, window, document */
    // 隐藏 webdriver 特征
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });
    // 覆盖 plugins 和 languages
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["zh-CN", "zh", "en"],
    });
    // 覆盖 permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
    // 隐藏 Chrome 自动化特征
    (window as any).chrome = {
      runtime: {},
    };
    // 覆盖 Notification 权限
    Object.defineProperty(Notification, "permission", {
      get: () => "default",
    });
    // 覆盖 getBattery
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery = () =>
        Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
        });
    }
  });
  // 设置额外的 HTTP 头
  await page.setExtraHTTPHeaders({
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  });
}


function headersToRecord(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}


// 从 URL 提取域名（用于设置 cookies，去掉 www 前缀）
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return "";
  }
}


/** 复用启动时默认页，避免 newPage() 再开一个 about:blank 导致多标签 */
function getDefaultPage(browser: Browser): Promise<Page> {
  return browser.pages().then((p) => p[0] ?? browser.newPage());
}


/** 预检认证：用 userDataDir 启动浏览器检查是否已登录；返回 true 表示通过，false 表示需登录 */
export async function preCheckAuth(authFlow: AuthFlow, cacheDir: string): Promise<boolean> {
  const { checkAuth, loginUrl, domain } = authFlow;
  if (domain == null || !cacheDir) return true;
  const userDataDir = getUserDataDir(cacheDir, domain);
  const isHeadless = true;
  const browser = await puppeteer.launch({ headless: isHeadless, args: launchArgs({ headless: isHeadless }), userDataDir });
  try {
    const page = await getDefaultPage(browser);
    const realUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    await page.setUserAgent(realUserAgent);
    await page.setViewport({ width: 1366, height: isHeadless ? 5000 : 960 });
    await stealthPage(page);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const currentUrl = page.url();
    return await checkAuth(page, currentUrl);
  } finally {
    await browser.close();
  }
}


// 执行认证流程：使用有头浏览器检查是否已登录，未通过则等待用户登录
export async function ensureAuth(
  authFlow: AuthFlow,
  cacheDir: string
): Promise<void> {
  const { checkAuth, loginUrl, domain, loginTimeoutMs = 60 * 1000, pollIntervalMs = 2000 } = authFlow;
  const userDataDir = getUserDataDir(cacheDir, domain);
  const isHeadless = false;
  const browser = await puppeteer.launch({ headless: isHeadless, args: launchArgs({ headless: isHeadless }), userDataDir });
  try {
    const page = await getDefaultPage(browser);
    const realUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    await page.setUserAgent(realUserAgent);
    await page.setViewport({ width: 1366, height: 960 });
    await stealthPage(page);
    console.log(`[Auth] 打开登录页面: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const currentUrl = page.url();
    const authenticated = await checkAuth(page, currentUrl);
    if (authenticated) {
      console.log(`[Auth] domain ${domain ?? "unknown"} 已登录，无需重新登录`);
      return;
    }
    console.log(`[Auth] domain ${domain ?? "unknown"} 未登录或已失效，等待用户登录...`);
    const startTime = Date.now();
    while (Date.now() - startTime < loginTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const currentUrl = page.url();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const authenticated = await checkAuth(page, currentUrl);
      if (authenticated) {
        console.log("[Auth] 登录成功，userDataDir 已持久化登录态");
        return;
      }
    }
    throw new Error(`登录超时（${loginTimeoutMs}ms）`);
  } finally {
    await browser.close();
  }
}

// 使用 Puppeteer 打开页面并返回结构化 HTML 结果。cacheDir 负责写缓存（存原始 HTML，避免 purify 导致内容丢失）；useCache 仅控制是否读缓存；purify 仅在返回时应用
export async function fetchHtml(url: string, config: RequestConfig = {}): Promise<StructuredHtmlResult> {
  const { timeoutMs, headers, cookies, cacheDir, cacheKeyStrategy, cacheMaxAgeMs, useCache, checkAuth, authFlow, purify, headless } =
    config;
  if (useCache !== false && cacheDir != null && cacheDir !== "") {
    const cached = await readCached(cacheDir, url, {
      strategy: cacheKeyStrategy,
      maxAgeMs: cacheMaxAgeMs,
    });
    if (cached != null) {
      const body = applyPurify(cached.body, purify);
      return { ...cached, body };
    }
  }
  const isHeadless = headless !== false;
  // 确定 domain：优先使用 authFlow.domain，否则从 URL 提取
  const domain = authFlow?.domain ?? (url ? extractDomain(url) : undefined);
  const userDataDir = getUserDataDir(cacheDir, domain);
  const browser = await puppeteer.launch({ headless: isHeadless, args: launchArgs({ ...config, headless: isHeadless }), userDataDir });
  try {
    const page = await getDefaultPage(browser);
    const realUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    await page.setUserAgent(realUserAgent);
    // headless 模式下使用更高的视口高度，有助于首次加载；headful 模式下使用较小高度便于观察
    await page.setViewport({ width: 1366, height: isHeadless ? 5000 : 960 });
    // 注入反检测脚本
    await stealthPage(page);
    const extraHeaders: Record<string, string> = { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", ...(headers ?? {}) };
    if (cookies != null && cookies !== "") {
      extraHeaders.cookie = cookies;
    }
    await page.setExtraHTTPHeaders(extraHeaders);
    const proxy = resolveProxy(config);
    if (proxy) {
      const { username, password } = parseProxy(proxy);
      if (username !== undefined || password !== undefined) {
        await page.authenticate({ username: username ?? "", password: password ?? "" });
      }
    }
    const navigationTimeout = timeoutMs ?? 60000;
    if (timeoutMs != null) {
      await page.setDefaultNavigationTimeout(timeoutMs);
    }
    // 导航到目标 URL，userDataDir 会自动加载持久化的 cookies、localStorage、sessionStorage
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    // 等待页面加载完成：等待 load 事件和 JS 执行
    try {
      await page.waitForFunction(
        () => {
          /* global document, window */
          return document.readyState === "complete";
        },
        { timeout: 10000 }
      ).catch(() => {});
    } catch {
      // 如果等待失败，继续执行
    }
    // 额外等待一段时间，确保 JS 动态内容加载完成（特别是 React/Vue 等框架的 hydration）
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (checkAuth != null || authFlow != null) {
      const authCheck = checkAuth ?? authFlow?.checkAuth;
      if (authCheck != null) {
        const ok = await authCheck(page, url);
        if (!ok) {
          throw new Error("checkAuth failed: 未通过认证检查，请先调用 ensureAuth 进行预处理登录");
        }
      }
    }
    const rawBody = await page.content();
    const finalUrl = response?.url() ?? page.url() ?? String(url);
    const status = response?.status() ?? 0;
    const statusText = response?.statusText() ?? "";
    const rawHeaders = response?.headers() ?? {};
    const normalizedHeaders = headersToRecord(rawHeaders);
    const resultForCache: StructuredHtmlResult = { finalUrl, status, statusText, headers: normalizedHeaders, body: rawBody };
    if (cacheDir != null && cacheDir !== "") {
      await writeCached(cacheDir, url, resultForCache, { strategy: cacheKeyStrategy });
    }
    const body = applyPurify(rawBody, purify);
    return { finalUrl, status, statusText, headers: normalizedHeaders, body };
  } finally {
    await browser.close();
  }
}