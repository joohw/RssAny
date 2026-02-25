// 站点抽象接口：声明 URL 模式及 fetchItems / enrichItem 能力（WebSource 专用）

import type { AuthFlow, CheckAuthFn } from "../../auth/index.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";
import type { FeedItem } from "../../types/feedItem.js";


/** 框架注入给插件的调用上下文，提供浏览器抓取工具 */
export interface SiteContext {
  /** 缓存目录 */
  cacheDir?: string;
  /** 是否无头浏览器 */
  headless?: boolean;
  /** 代理地址 */
  proxy?: string;
  /**
   * 用浏览器抓取指定 URL，返回渲染后的 HTML。
   * 插件需要访问网页时调用此方法，框架负责浏览器管理与 cookie 注入。
   */
  fetchHtml(url: string, opts?: { waitMs?: number }): Promise<{ html: string; finalUrl: string; status: number }>;
}


/** 站点抽象接口：声明该站点支持的 URL 模式及数据获取能力 */
export interface Site {
  /** 站点标识，如 "xiaohongshu"、"lingowhale" */
  readonly id: string;
  /** 列表页 URL 匹配模式，{placeholder} 匹配路径段 */
  readonly listUrlPattern: string | RegExp;
  /** 条目有效时间窗口；不填默认 1day */
  readonly refreshInterval?: RefreshInterval;
  /** 代理地址；不填则使用 env HTTP_PROXY */
  readonly proxy?: string;
  /**
   * 核心能力：给定 sourceId，返回条目列表。
   * 插件自行决定如何获取数据（调用 ctx.fetchHtml、直接 fetch API 等均可）。
   */
  fetchItems(sourceId: string, ctx: SiteContext): Promise<FeedItem[]>;
  /**
   * 可选：对单条目异步补全正文（后台任务）。
   * 返回携带 contentHtml 的完整条目。
   */
  enrichItem?(item: FeedItem, ctx: SiteContext): Promise<FeedItem>;
  /** 认证：检查是否已登录 */
  checkAuth?: CheckAuthFn | null;
  /** 认证：登录页 URL */
  loginUrl?: string | null;
  /** 认证：域名，cookies 保存在 domains/{domain}.json */
  domain?: string | null;
  /** 认证：等待登录超时毫秒，默认 300000 */
  loginTimeoutMs?: number | null;
  /** 认证：轮询 checkAuth 间隔毫秒，默认 2000 */
  pollIntervalMs?: number | null;
}


/** 将字符串 URL 模式转为正则：{xxx} → [^/]+，末尾允许 ?query */
function patternToRegex(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  const pathOnly = pattern.split("?")[0];
  const pl = "<<<__PL__>>>";
  const s = pathOnly
    .replace(/\{[^}]*\}/g, pl)
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c)
    .replace(new RegExp(pl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[^/]+");
  return new RegExp("^" + s + "(\\?.*)?$");
}


/** 从 Site 扁平字段构建 AuthFlow，无需登录时返回 undefined */
export function toAuthFlow(site: Site): AuthFlow | undefined {
  if (!site.checkAuth || !site.loginUrl) return undefined;
  return {
    checkAuth: site.checkAuth,
    loginUrl: site.loginUrl,
    domain: site.domain ?? undefined,
    loginTimeoutMs: site.loginTimeoutMs ?? undefined,
    pollIntervalMs: site.pollIntervalMs ?? undefined,
  };
}


/** 判断 URL 是否匹配站点的 listUrlPattern */
export function matchesListUrl(site: Site, url: string): boolean {
  try {
    return patternToRegex(site.listUrlPattern).test(url);
  } catch {
    return false;
  }
}


/** 根据 listUrlPattern 自动计算 URL 匹配具体度（不匹配返回 -1） */
export function computeSpecificity(site: Site, url: string): number {
  if (!matchesListUrl(site, url)) return -1;
  const p = site.listUrlPattern;
  if (typeof p === "string") {
    const pathOnly = p.split("?")[0];
    return 1000 + pathOnly.split("/").filter(Boolean).length;
  }
  return p.source.length;
}


/** 根据 URL 查找匹配的站点实例，返回具体度最高的站点 */
export function getSiteByUrl(url: string, sites: Site[]): Site | undefined {
  const matched = sites
    .map((s) => ({ site: s, score: computeSpecificity(s, url) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return matched[0]?.site;
}
