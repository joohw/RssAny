// 站点抽象接口：声明 URL 形态、parser、extractor、auth

import type { CustomParserFn } from "../parser/parser.js";
import type { CustomExtractorFn } from "../extractor/types.js";
import type { AuthFlow, CheckAuthFn } from "../auth/index.js";


/** 将 listUrlPattern 转为 RegExp：{xxx} → [^/]+，其余转义，末尾允许 ?query */
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


/** 站点抽象接口：负责声明该站点支持的 URL 形态及解析/提取/认证能力 */
export interface Site {
  /** 站点标识，如 "xiaohongshu" */
  readonly id: string;
  /** 列表页 URL 模式，{placeholder} 匹配路径段，如 "https://example.com/user/{id}" */
  readonly listUrlPattern: string | RegExp;
  /** 详情页 URL 模式，用于 /extractor 匹配；不填则按 domain 匹配，如 "https://www.xiaohongshu.com/explore/{noteId}" */
  readonly detailUrlPattern?: string | RegExp | null;
  /** 列表页解析器，不填则使用 LLM 解析 */
  readonly parser?: CustomParserFn | null;
  /** 详情页正文提取器，不填则使用 LLM 提取 */
  readonly extractor?: CustomExtractorFn | null;
  /** 认证：检查是否已登录；(page, url) => Promise<boolean>，返回 false 表示需登录 */
  checkAuth?: CheckAuthFn | null;
  /** 认证：登录页 URL，checkAuth 失败时打开此页让用户手动登录 */
  loginUrl?: string | null;
  /** 认证：域名，cookies 保存在 domains/{domain}.json，如 "xiaohongshu.com" */
  domain?: string | null;
  /** 认证：等待登录超时毫秒，默认 300000 */
  loginTimeoutMs?: number | null;
  /** 认证：轮询 checkAuth 间隔毫秒，默认 2000 */
  pollIntervalMs?: number | null;
}


/** 根据 listUrlPattern 自动计算 URL 匹配具体度（不匹配返回 -1），数值越大越具体 */
export function computeSpecificity(site: Site, url: string): number {
  if (!matchesListUrl(site, url)) return -1;
  const p = site.listUrlPattern;
  if (typeof p === "string") {
    const pathOnly = p.split("?")[0];
    return pathOnly.split("/").filter(Boolean).length;
  }
  return 1;
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


/** 判断 URL 是否匹配站点的 detailUrlPattern（未配置则返回 false） */
export function matchesDetailUrl(site: Site, url: string): boolean {
  const p = site.detailUrlPattern;
  if (p == null || p === "") return false;
  try {
    return patternToRegex(p).test(url);
  } catch {
    return false;
  }
}


/** 根据 detailUrlPattern 计算匹配具体度（不匹配或未配置返回 -1） */
export function computeDetailSpecificity(site: Site, url: string): number {
  if (!matchesDetailUrl(site, url)) return -1;
  const p = site.detailUrlPattern;
  if (p == null) return -1;
  if (typeof p === "string") {
    const pathOnly = p.split("?")[0];
    return pathOnly.split("/").filter(Boolean).length;
  }
  return 1;
}


/** 根据 URL 查找匹配的站点实例，返回具体度最高的站点 */
export function getSiteByUrl(url: string, sites: Site[]): Site | undefined {
  const matched = sites
    .map((s) => ({ site: s, score: computeSpecificity(s, url) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return matched[0]?.site;
}


/** 根据详情页 URL 查找「有 extractor 且 detailUrlPattern 或 domain 匹配」的站点；优先 detailUrlPattern，否则按 domain 兜底 */
export function getSiteForExtraction(url: string, sites: Site[]): Site | undefined {
  const withExtractor = sites.filter((s) => s.extractor != null && s.extractor !== undefined);
  const byDetail = withExtractor
    .map((s) => ({ site: s, score: computeDetailSpecificity(s, url) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (byDetail.length > 0) return byDetail[0].site;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }
  for (const site of withExtractor) {
    const d = site.domain?.trim();
    if (!d) continue;
    if (hostname === d || hostname.endsWith("." + d) || hostname === "www." + d || hostname.replace(/^www\./, "") === d) return site;
  }
  return undefined;
}
