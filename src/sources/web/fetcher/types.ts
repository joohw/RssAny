// fetcher 请求配置：对 fetch RequestInit 的封装与扩展

import type { BrowserContext } from "puppeteer-core";
import type { AuthFlow, CheckAuthFn } from "../../../auth/index.js";


/** 缓存键策略：forever=仅 sha256(url)；其余值将时间窗口嵌入 key，窗口过期后 key 自然失效，无需主动 TTL 检查 */
export type CacheKeyStrategy = "forever" | "10min" | "30min" | "1h" | "6h" | "12h" | "1day" | "3day" | "7day";


export interface RequestConfig {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  /** 请求时携带的 Cookie 字符串（会写入 Cookie 头）；可从环境变量/密钥读取 */
  cookies?: string;
  body?: string | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams;
  redirect?: "follow" | "manual" | "error";
  signal?: AbortSignal;
  /** 超时毫秒，内部用 AbortController 实现 */
  timeoutMs?: number;
  /** 启用时：拉取结果会写入该目录（写缓存）。读不读缓存由 useCache 控制 */
  cacheDir?: string;
  /** 缓存键策略：forever=仅 sha256(url)；daily=日期+sha256(url)，按日更新；hourly=小时+sha256(url)。默认 forever */
  cacheKeyStrategy?: CacheKeyStrategy;
  /** 缓存最大存活毫秒数；若设置，读缓存时会检查写入时间，超时则视为未命中。与 cacheKeyStrategy 可同时使用 */
  cacheMaxAgeMs?: number;
  /** 为 true 或未设时：若 cacheDir 存在则先读缓存，命中则直接返回。为 false 时不读缓存（写缓存仍由 cacheDir 决定，便于调试时强制回源仍可落盘） */
  useCache?: boolean;
  /** 隔离认证函数（见 authenticator）：拉取后调用，返回 false 时视为未通过认证并抛错 */
  checkAuth?: CheckAuthFn;
  /** 认证流程配置：仅用于从 profile 加载 cookies，不自动执行登录。登录需调用 ensureAuth 预处理 */
  authFlow?: AuthFlow;
  /** 剥离 RSS 内容无关部分（script/style/svg/link/meta/注释/input/button/select/textarea/nav/iframe/noscript/template/object/embed/canvas/base64 内联图/class 与 style 属性）；默认 true；为 false 时不做剥离 */
  purify?: boolean;
  /** 为 false 时使用有头浏览器（窗口可见），便于调试 403 等反爬；默认 true 无头 */
  headless?: boolean;
  /** 代理，如 http://127.0.0.1:7890、socks5://127.0.0.1:1080；需认证时用 http://user:pass@host:port；不设时从 HTTP_PROXY/HTTPS_PROXY 读取 */
  proxy?: string;
  /** Chrome 可执行文件路径，不提供则自动查找系统 Chrome 或使用 CHROME_PATH 环境变量 */
  chromeExecutablePath?: string;
  /** 浏览器上下文配置函数：在创建页面后调用，可用于设置 cookies、localStorage 等；(context) => Promise<void> */
  browserContext?: ((context: BrowserContext) => Promise<void>) | null;
}


// fetcher 返回的结构化 HTML 结果
export interface StructuredHtmlResult {
  /** 最终 URL（含重定向后） */
  finalUrl: string;
  /** HTTP 状态码 */
  status: number;
  statusText: string;
  /** 响应头，键小写 */
  headers: Record<string, string>;
  /** 响应体（HTML 字符串） */
  body: string;
}
