// 使用无头浏览器（Puppeteer）拉取页面，缓存逻辑在 cacher 中

import { exec } from "node:child_process";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import puppeteerCore, { type Browser, type Page } from "puppeteer-core";
import { readCached, writeCached } from "../../../../core/cacher/index.js";
import { applyPurify } from "./purify.js";
import { findChromeExecutable } from "./cdp.js";
import type { AuthFlow } from "../../../auth/index.js";
import type { RequestConfig, StructuredHtmlResult } from "./types.js";
import { logger } from "../../../../core/logger/index.js";

const execAsync = promisify(exec);


/** 解析代理：优先 config.proxy，否则从 HTTP_PROXY/HTTPS_PROXY 读取 */
function resolveProxy(config?: { proxy?: string }): string | undefined {
  return config?.proxy ?? process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY;
}


/** 从代理字符串解析出 serverUrl 和可选账号密码；支持 http://user:pass@host:port */
function parseProxy(proxy: string): { serverUrl: string; username?: string; password?: string } {
  const u = new URL(proxy);
  const serverUrl = u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
  const username = u.username || undefined;
  const password = u.password || undefined;
  return { serverUrl, username, password };
}


/** 构建 Puppeteer launch args */
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
  const height = config?.headless !== false ? 5000 : 960;
  base.push(`--window-size=1366,${height}`);
  const proxy = resolveProxy(config);
  if (proxy) {
    const { serverUrl } = parseProxy(proxy);
    base.push(`--proxy-server=${serverUrl}`);
  }
  return base;
}


/** 获取 userDataDir：统一使用 main 目录，所有站点共享同一浏览器 profile */
function getUserDataDir(cacheDir?: string): string | undefined {
  if (!cacheDir) return undefined;
  return join(cacheDir, "browser_data", "main");
}


/** 是否为「userDataDir 已被占用」的报错（上次进程未正常退出或并发启动） */
function isAlreadyRunningError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /already running/i.test(msg) && /userDataDir|user-data-dir|user data dir/i.test(msg);
}


/**
 * 强制结束占用指定 userDataDir 的 Chrome/Chromium 进程（上次未正常退出时残留）。
 * 仅在 darwin/linux 下执行；启动前调用以释放 profile 锁。
 */
async function killStaleChromeProcesses(absUserDataDir: string): Promise<void> {
  const plat = platform();
  if (plat !== "darwin" && plat !== "linux") {
    return;
  }
  try {
    // 匹配命令行中包含该 userDataDir 的进程（Chrome 使用 --user-data-dir=/path）
    const psCmd = plat === "darwin"
      ? `ps -eww -o pid= -o args= 2>/dev/null`
      : `ps -eo pid,args --no-headers 2>/dev/null`;
    const { stdout } = await execAsync(psCmd, { maxBuffer: 4 * 1024 * 1024 });
    const pids = new Set<number>();
    const lineRegex = /^\s*(\d+)\s+/;
    for (const line of stdout.split("\n")) {
      if (!line.includes(absUserDataDir)) continue;
      const m = line.match(lineRegex);
      if (m) pids.add(parseInt(m[1], 10));
    }
    if (pids.size === 0) return;
    logger.info("source", "发现占用 browser_data 的 Chrome 进程，正在结束", { pids: [...pids], userDataDir: absUserDataDir });
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 进程可能已退出
      }
    }
    await new Promise((r) => setTimeout(r, 800));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    logger.warn("source", "结束残留 Chrome 进程时出错", { err: err instanceof Error ? err.message : String(err) });
  }
}


// 注入脚本隐藏自动化特征
async function stealthPage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    /* global navigator, window, document */
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
    const originalQuery = window.navigator.permissions.query;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = { runtime: {} };
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 });
    }
  });
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


/** 对新 Page 做通用初始化：UA、Viewport、stealth 脚本 */
async function setupPage(page: Page, headless = true): Promise<void> {
  const realUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  await page.setUserAgent(realUserAgent);
  await page.setViewport({ width: 1366, height: headless ? 5000 : 960 });
  await stealthPage(page);
}


// ─── 浏览器单例 ───────────────────────────────────────────────────────────────
// 全局只保持一个浏览器进程。所有请求（无头/有头）均在此浏览器内开新 Tab。
// 有头请求到来时若当前是无头浏览器，则关闭并重开有头浏览器（反之亦然）。

let _browser: Browser | null = null;
let _browserHeadless = true;
let _launchPromise: Promise<Browser> | null = null;


/** 判断浏览器是否健在 */
async function isBrowserAlive(): Promise<boolean> {
  if (!_browser) return false;
  try {
    await _browser.version();
    return true;
  } catch {
    _browser = null;
    return false;
  }
}


/**
 * 获取（或启动）浏览器单例。
 * - 若浏览器已运行且模式匹配 → 直接返回
 * - 若浏览器已运行但模式不匹配（无头↔有头）→ 关闭后重开
 * - 若浏览器未运行 → 启动新实例
 */
export async function getOrCreateBrowser(config: {
  headless?: boolean;
  cacheDir?: string;
  proxy?: string;
  chromeExecutablePath?: string;
}): Promise<Browser> {
  const wantHeadless = config.headless !== false;
  // 浏览器已运行
  if (await isBrowserAlive()) {
    // 模式一致：直接复用
    if (_browserHeadless === wantHeadless) {
      return _browser!;
    }
    // 模式不一致（无头→有头 或 有头→无头）：关闭后重开
    logger.info("source", "浏览器切换模式", { from: _browserHeadless ? "无头" : "有头", to: wantHeadless ? "无头" : "有头" });
    await _browser!.close().catch(() => {});
    _browser = null;
    _launchPromise = null;
  }
  // 防止并发重复启动
  if (!_launchPromise) {
    _launchPromise = (async () => {
      const executablePath = config.chromeExecutablePath ?? process.env.CHROME_PATH ?? findChromeExecutable();
      if (!executablePath) {
        throw new Error("未找到 Chrome 可执行文件，请安装 Google Chrome 或设置 CHROME_PATH 环境变量");
      }
      const userDataDir = getUserDataDir(config.cacheDir);
      const maxRetries = 2;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt === 0 && userDataDir) {
            const absUserDataDir = resolve(userDataDir);
            await killStaleChromeProcesses(absUserDataDir);
          }
          if (attempt > 0) {
            const waitMs = attempt * 2000;
            logger.info("source", "userDataDir 曾被占用，等待后重试", { waitMs, attempt });
            await new Promise((r) => setTimeout(r, waitMs));
          }
          logger.info("source", "启动 Chrome", { headless: wantHeadless, executablePath });
          const browser = await puppeteerCore.launch({
            headless: wantHeadless,
            args: launchArgs({ proxy: config.proxy, headless: wantHeadless }),
            userDataDir,
            executablePath,
            ignoreDefaultArgs: ["--enable-automation"],
          });
          browser.on("disconnected", () => {
            _browser = null;
            _launchPromise = null;
          });
          _browser = browser;
          _browserHeadless = wantHeadless;
          return browser;
        } catch (e) {
          lastErr = e;
          if (attempt < maxRetries && isAlreadyRunningError(e)) {
            continue;
          }
          if (isAlreadyRunningError(e)) {
            const dir = userDataDir ?? "browser_data/main";
            throw new Error(
              `Chrome 的 profile 目录已被占用（${dir}）。通常是因为上次未正常退出或同时运行了多个 RssAny 进程。请关闭占用该目录的 Chrome 进程后重试，或设置环境变量 CACHE_DIR 使用不同缓存目录。`
            );
          }
          throw e;
        }
      }
      throw lastErr;
    })().catch((e) => {
      _launchPromise = null;
      throw e;
    });
  }
  return _launchPromise;
}


// 进程退出时关闭浏览器，防止僵尸进程
process.once("exit", () => { _browser?.close().catch(() => {}); });
process.once("SIGINT", async () => { await _browser?.close().catch(() => {}); process.exit(0); });
process.once("SIGTERM", async () => { await _browser?.close().catch(() => {}); process.exit(0); });


// ─── 对外 API ─────────────────────────────────────────────────────────────────

/** 预检认证：复用共享浏览器（新开 Tab）检查是否已登录 */
export async function preCheckAuth(authFlow: AuthFlow, cacheDir: string): Promise<boolean> {
  const { checkAuth, loginUrl, domain } = authFlow;
  if (domain == null || !cacheDir) return true;
  const browser = await getOrCreateBrowser({ headless: true, cacheDir });
  const page = await browser.newPage();
  try {
    await setupPage(page, true);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return await checkAuth(page, page.url());
  } finally {
    await page.close().catch(() => {});
  }
}


// 执行认证流程：用有头浏览器（若无头在运行则切换）打开登录页，等待用户完成登录
export async function ensureAuth(
  authFlow: AuthFlow,
  cacheDir: string
): Promise<void> {
  const { checkAuth, loginUrl, domain, loginTimeoutMs = 60 * 1000, pollIntervalMs = 2000 } = authFlow;
  const browser = await getOrCreateBrowser({ headless: false, cacheDir });
  const page = await browser.newPage();
  try {
    await setupPage(page, false);
    logger.info("auth", "打开登录页面", { loginUrl });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const authenticated = await checkAuth(page, page.url());
    if (authenticated) {
      logger.info("auth", "已登录，无需重新登录", { domain: domain ?? "unknown" });
      return;
    }
    logger.info("auth", "未登录或已失效，等待用户登录", { domain: domain ?? "unknown" });
    const startTime = Date.now();
    while (Date.now() - startTime < loginTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const authenticated = await checkAuth(page, page.url());
      if (authenticated) {
        logger.info("auth", "登录成功，userDataDir 已持久化登录态");
        return;
      }
    }
    throw new Error(`登录超时（${loginTimeoutMs}ms）`);
  } finally {
    await page.close().catch(() => {});
  }
}


// 使用浏览器单例打开页面并返回结构化 HTML 结果；每次请求开新 Tab，用完关 Tab
export async function fetchHtml(url: string, config: RequestConfig = {}): Promise<StructuredHtmlResult> {
  const { timeoutMs, headers, cookies, cacheDir, cacheKeyStrategy, cacheMaxAgeMs, useCache, checkAuth, authFlow, purify, headless, waitAfterLoadMs } =
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
  const browser = await getOrCreateBrowser({
    headless: isHeadless,
    cacheDir,
    proxy: resolveProxy(config),
    chromeExecutablePath: config.chromeExecutablePath,
  });
  const page = await browser.newPage();
  try {
    if (config.browserContext) {
      await config.browserContext(page.browserContext());
    }
    await setupPage(page, isHeadless);
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
    // 等待所有 HTTP 重定向及资源加载完毕，避免 JS 跳转导致 detached Frame
    const response = await page.goto(url, { waitUntil: "load", timeout: navigationTimeout });
    // 额外等待确保 JS 动态内容加载（React/Vue 等框架 hydration）
    const extraWaitMs = Math.max(0, waitAfterLoadMs ?? 2000);
    if (extraWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, extraWaitMs));
    }
    if (checkAuth != null || authFlow != null) {
      const authCheck = checkAuth ?? authFlow?.checkAuth;
      if (authCheck != null) {
        const ok = await authCheck(page, url);
        if (!ok) {
          throw new Error("checkAuth failed: 未通过认证检查，请先调用 ensureAuth 进行预处理登录");
        }
      }
    }
    // 获取页面内容；若因 JS 跳转导致 frame 失效则等待后重试
    let rawBody: string;
    try {
      rawBody = await page.content();
    } catch (e) {
      if (e instanceof Error && (e.message.includes("detached") || e.message.includes("Session closed"))) {
        await new Promise((r) => setTimeout(r, 1500));
        rawBody = await page.content();
      } else {
        throw e;
      }
    }
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
    // 只关闭 Tab，浏览器继续运行
    await page.close().catch(() => {});
  }
}
