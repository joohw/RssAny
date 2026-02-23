// 缓存管理：fetch 结果缓存、认证 profile 缓存

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CacheKeyStrategy, StructuredHtmlResult } from "../fetcher/types.js";


const FETCHED_SUBDIR = "fetched";
const LOGS_SUBDIR = "logs";
const DOMAINS_SUBDIR = "domains";


/** 认证配置档：可存 cookies、localStorage、sessionStorage 等，由 cacher 写入 cacheDir/domains/ */
export interface AuthProfile {
  cookies?: string;
  localStorage?: string;
  sessionStorage?: string;
  [key: string]: unknown;
}


function profileFileName(domain: string): string {
  return `${domain.replace(/[/\\]/g, "_")}.json`;
}


// 缓存 JSON 结构：元数据 + 可选 body/bodyFile + 写入时间（用于 TTL）
interface CacheMeta {
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  bodyFile?: string;
  /** 写入时间 ISO 字符串，用于 cacheMaxAgeMs 判断 */
  cachedAt?: string;
}


function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}


// 根据 URL 与策略生成缓存 key：forever=仅 sha256(url)；daily=YYYY-MM-DD-{hash}；hourly=YYYY-MM-DDTHH-{hash}（均为 UTC）
export function cacheKey(url: string, strategy: CacheKeyStrategy = "forever", now: Date = new Date()): string {
  const hash = urlHash(url);
  if (strategy === "forever") return hash;
  const iso = now.toISOString();
  if (strategy === "daily") return `${iso.slice(0, 10)}-${hash}`;
  if (strategy === "hourly") return `${iso.slice(0, 13)}-${hash}`;
  return hash;
}


/** 读缓存时的选项 */
export interface ReadCacheOptions {
  strategy?: CacheKeyStrategy;
  /** 最大存活毫秒数，超时则视为未命中 */
  maxAgeMs?: number;
}


/** 写缓存时的选项 */
export interface WriteCacheOptions {
  strategy?: CacheKeyStrategy;
}


// 从缓存目录读取指定 URL 的缓存结果，不存在、损坏或已过期则返回 null（先读 logs/{key}.json，兼容旧版 fetched/{key}.json）
export async function readCached(
  cacheDir: string,
  url: string,
  options: ReadCacheOptions = {}
): Promise<StructuredHtmlResult | null> {
  const { strategy = "forever", maxAgeMs } = options;
  const key = cacheKey(url, strategy);
  const fetchedDir = join(cacheDir, FETCHED_SUBDIR);
  const logsDir = join(cacheDir, LOGS_SUBDIR);
  let raw: string;
  try {
    raw = await readFile(join(logsDir, `${key}.json`), "utf-8");
  } catch {
    try {
      raw = await readFile(join(fetchedDir, `${key}.json`), "utf-8");
    } catch {
      return null;
    }
  }
  try {
    const meta = JSON.parse(raw) as CacheMeta;
    if (maxAgeMs != null) {
      const cachedAt = typeof meta.cachedAt === "string" ? new Date(meta.cachedAt).getTime() : 0;
      if (Date.now() - cachedAt > maxAgeMs) return null;
    }
    let body: string;
    if (typeof meta.body === "string") {
      body = meta.body;
    } else if (typeof meta.bodyFile === "string") {
      const htmlPath = join(fetchedDir, meta.bodyFile);
      body = await readFile(htmlPath, "utf-8");
    } else {
      return null;
    }
    return { finalUrl: meta.finalUrl, status: meta.status, statusText: meta.statusText, headers: meta.headers, body };
  } catch {
    return null;
  }
}


// 将结果写入缓存目录：HTML 写 fetched/{key}.html，元数据写 logs/{key}.json（含 cachedAt）
export async function writeCached(
  cacheDir: string,
  url: string,
  result: StructuredHtmlResult,
  options: WriteCacheOptions = {}
): Promise<void> {
  const { strategy = "forever" } = options;
  const fetchedDir = join(cacheDir, FETCHED_SUBDIR);
  const logsDir = join(cacheDir, LOGS_SUBDIR);
  await mkdir(fetchedDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  const key = cacheKey(url, strategy);
  const htmlFileName = `${key}.html`;
  await writeFile(join(fetchedDir, htmlFileName), result.body, "utf-8");
  const meta: CacheMeta = {
    finalUrl: result.finalUrl,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    bodyFile: htmlFileName,
    cachedAt: new Date().toISOString(),
  };
  await writeFile(join(logsDir, `${key}.json`), JSON.stringify(meta, null, 2), "utf-8");
}


// 从 cacheDir/domains/{domain}.json 读取认证配置（未来可扩展为 domains/{domain}/{profileName}.json）
export async function readProfile(cacheDir: string, domain: string): Promise<AuthProfile | null> {
  const dir = join(cacheDir, DOMAINS_SUBDIR);
  const filePath = join(dir, profileFileName(domain));
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as AuthProfile;
  } catch {
    return null;
  }
}


// 将认证配置写入 cacheDir/domains/{domain}.json
export async function writeProfile(cacheDir: string, domain: string, data: AuthProfile): Promise<void> {
  const dir = join(cacheDir, DOMAINS_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, profileFileName(domain));
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}
