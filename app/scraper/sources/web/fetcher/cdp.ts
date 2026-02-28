// Chrome DevTools Protocol (CDP) 控制模块：支持连接到手动启动的 Chrome，避免安装 Puppeteer 专属 Chrome

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import puppeteerCore, { type Browser, type ConnectOptions, type LaunchOptions } from "puppeteer-core";


/** 按平台枚举所有可能的 Chrome 路径，优先返回第一个实际存在的；全部不存在则返回 null */
export function findChromeExecutable(): string | null {
  const platformName = platform();
  const paths: string[] = [];
  const envChrome = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (envChrome) paths.push(envChrome);
  if (platformName === "darwin") {
    paths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else if (platformName === "linux") {
    paths.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium"
    );
  } else if (platformName === "win32") {
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    paths.push(
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  }
  for (const p of paths) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // 跳过
    }
  }
  return null;
}


/** CDP 连接配置 */
export interface CDPConfig {
  /** Chrome 可执行文件路径，不提供则自动查找 */
  executablePath?: string;
  /** CDP 端口，默认 9222 */
  port?: number;
  /** 是否使用已启动的 Chrome（不自动启动） */
  useExisting?: boolean;
  /** userDataDir，用于持久化 cookies 等 */
  userDataDir?: string;
  /** 是否无头模式 */
  headless?: boolean;
  /** 代理配置 */
  proxy?: string;
  /** 额外的 Chrome 启动参数 */
  args?: string[];
}


/** 启动 Chrome 进程并返回 CDP WebSocket URL */
async function launchChromeWithCDP(config: CDPConfig): Promise<{ process: ChildProcess; wsEndpoint: string }> {
  const port = config.port ?? 9222;
  const executablePath = config.executablePath || findChromeExecutable();
  if (!executablePath) {
    throw new Error("未找到 Chrome 可执行文件，请设置 CHROME_PATH 环境变量或提供 executablePath");
  }
  const args: string[] = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-infobars",
  ];
  if (config.headless !== false) {
    args.push("--headless=new");
  }
  if (config.userDataDir) {
    args.push(`--user-data-dir=${config.userDataDir}`);
  }
  if (config.proxy) {
    const u = new URL(config.proxy);
    const serverUrl = u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
    args.push(`--proxy-server=${serverUrl}`);
  }
  if (config.args) {
    args.push(...config.args);
  }
  const process = spawn(executablePath, args, {
    stdio: ["ignore", "ignore", "ignore"],
    detached: false,
  });
  // 等待 CDP 端点可用
  const wsEndpoint = `ws://127.0.0.1:${port}/devtools/browser`;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Chrome 启动超时，无法连接到 CDP 端口 ${port}`));
    }, 30000);
    const checkInterval = setInterval(async () => {
      try {
        const http = await import("node:http");
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
          if (res.statusCode === 200) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        });
        req.on("error", () => {
          // 继续等待
        });
        req.end();
      } catch {
        // 继续等待
      }
    }, 500);
    process.on("error", (err) => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      reject(err);
    });
  });
  return { process, wsEndpoint };
}


/** 连接到已启动的 Chrome（通过 CDP 端口） */
async function connectToExistingChrome(port: number = 9222): Promise<string> {
  const wsEndpoint = `ws://127.0.0.1:${port}/devtools/browser`;
  try {
    const http = await import("node:http");
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`无法连接到 Chrome CDP 端口 ${port}`));
        }
      });
      req.on("error", (err) => {
        reject(new Error(`无法连接到 Chrome CDP 端口 ${port}，请确保 Chrome 已启动并开启 --remote-debugging-port=${port}: ${err.message}`));
      });
      req.end();
    });
    return wsEndpoint;
  } catch (err) {
    throw err instanceof Error ? err : new Error(`无法连接到 Chrome CDP 端口 ${port}，请确保 Chrome 已启动并开启 --remote-debugging-port=${port}`);
  }
}


/** 通过 CDP 连接到 Chrome 并返回 Browser 对象 */
export async function connectBrowser(config: CDPConfig): Promise<{ browser: Browser; cleanup?: () => Promise<void> }> {
  let wsEndpoint: string;
  let chromeProcess: ChildProcess | undefined;
  if (config.useExisting) {
    wsEndpoint = await connectToExistingChrome(config.port);
  } else {
    const result = await launchChromeWithCDP(config);
    wsEndpoint = result.wsEndpoint;
    chromeProcess = result.process;
  }
  const connectOptions: ConnectOptions = {
    browserWSEndpoint: wsEndpoint,
  };
  const browser = await puppeteerCore.connect(connectOptions);
  const cleanup = chromeProcess
    ? async () => {
        await browser.disconnect();
        chromeProcess?.kill();
      }
    : async () => {
        await browser.disconnect();
      };
  return { browser, cleanup };
}


/** 通过 CDP 启动 Chrome 并返回 Browser 对象（使用 executablePath） */
export async function launchBrowser(config: CDPConfig & { executablePath: string }): Promise<{ browser: Browser; cleanup: () => Promise<void> }> {
  const port = config.port ?? 9222;
  const args: string[] = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-infobars",
  ];
  if (config.headless !== false) {
    args.push("--headless=new");
  }
  if (config.userDataDir) {
    args.push(`--user-data-dir=${config.userDataDir}`);
  }
  if (config.proxy) {
    const u = new URL(config.proxy);
    const serverUrl = u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
    args.push(`--proxy-server=${serverUrl}`);
  }
  if (config.args) {
    args.push(...config.args);
  }
  const launchOptions: LaunchOptions = {
    executablePath: config.executablePath,
    headless: config.headless !== false,
    args,
    userDataDir: config.userDataDir,
    ignoreDefaultArgs: ["--enable-automation"],
  };
  const browser = await puppeteerCore.launch(launchOptions);
  const cleanup = async () => {
    await browser.close();
  };
  return { browser, cleanup };
}


/** 导出类型供外部使用 */
export type { Browser, Page } from "puppeteer-core";
