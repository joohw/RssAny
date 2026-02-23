// 站点配置：从 .rssany/sites.json 加载，纯 URL 正则匹配，支持代理与刷新间隔

import { readFile, writeFile } from "node:fs/promises";
import type { CacheKeyStrategy } from "../fetcher/types.js";
import { SITES_CONFIG_PATH } from "../config/paths.js";


/** 刷新间隔类型（排除 forever，仅允许有时间语义的策略） */
export type RefreshInterval = Exclude<CacheKeyStrategy, "forever">;


/** 合法的刷新间隔值列表 */
const VALID_INTERVALS: RefreshInterval[] = ["10min", "30min", "1h", "6h", "12h", "1day", "3day", "7day"];


/** 单条站点配置 */
export interface SiteConfig {
  /** 代理地址，如 http://127.0.0.1:7890、socks5://127.0.0.1:1080 */
  proxy?: string;
  /** 刷新间隔（省略时默认 1day） */
  refresh?: RefreshInterval;
}


/** 内部条目：[pattern 字符串, 编译后正则, 配置] */
type ConfigEntry = [string, RegExp, SiteConfig];


/** 已加载的条目列表 */
let entries: ConfigEntry[] = [];


/** 根据 URL 获取站点配置；多条 pattern 匹配时按 pattern 长度降序取最具体，各字段独立合并 */
export function getSiteConfig(url: string): SiteConfig {
  const matches = entries
    .filter(([, regex]) => regex.test(url))
    .sort((a, b) => a[0].length - b[0].length);
  const merged: SiteConfig = {};
  for (const [, , cfg] of matches) {
    if (cfg.proxy != null) merged.proxy = cfg.proxy;
    if (cfg.refresh != null) merged.refresh = cfg.refresh;
  }
  return merged;
}


/** 获取刷新策略（默认 1day） */
export function getRefreshStrategy(url: string): RefreshInterval {
  return getSiteConfig(url).refresh ?? "1day";
}


/** 获取代理地址（无匹配返回 undefined） */
export function getProxy(url: string): string | undefined {
  return getSiteConfig(url).proxy;
}


/** 加载 .rssany/sites.json 配置文件 */
export async function loadSiteConfig(configPath?: string): Promise<void> {
  const path = configPath ?? SITES_CONFIG_PATH;
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) {
      console.warn("[SiteConfig] sites.json 格式无效，应为对象");
      return;
    }
    const loaded: ConfigEntry[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("$")) continue;
      try {
        const regex = new RegExp(key);
        const raw = value as Record<string, unknown>;
        const cfg: SiteConfig = {};
        if (typeof raw.proxy === "string") cfg.proxy = raw.proxy;
        if (typeof raw.refresh === "string" && (VALID_INTERVALS as string[]).includes(raw.refresh)) {
          cfg.refresh = raw.refresh as RefreshInterval;
        }
        loaded.push([key, regex, cfg]);
      } catch {
        console.warn(`[SiteConfig] 无效的正则表达式，已跳过: ${key}`);
      }
    }
    entries = loaded;
    console.log(`[SiteConfig] 已加载 ${entries.length} 条站点配置`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[SiteConfig] sites.json 不存在，跳过站点配置");
    } else {
      console.warn("[SiteConfig] 加载配置失败:", err instanceof Error ? err.message : String(err));
    }
    entries = [];
  }
}


/** 获取当前条目列表（用于 API 展示） */
export function getSiteConfigEntries(): ReadonlyArray<readonly [string, RegExp, SiteConfig]> {
  return entries;
}


/** 将内存中的 entries 持久化到 .rssany/sites.json */
async function saveSiteConfig(): Promise<void> {
  const obj: Record<string, SiteConfig> = {};
  for (const [pattern, , cfg] of entries) obj[pattern] = cfg;
  await writeFile(SITES_CONFIG_PATH, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}


/** 新增或更新一条站点配置；pattern 不合法时抛出 Error */
export async function upsertSiteConfigEntry(pattern: string, cfg: SiteConfig): Promise<void> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Error(`无效的正则表达式: ${pattern}`);
  }
  const idx = entries.findIndex(([p]) => p === pattern);
  if (idx >= 0) {
    entries[idx] = [pattern, regex, cfg];
  } else {
    entries.push([pattern, regex, cfg]);
  }
  await saveSiteConfig();
}


/** 删除一条站点配置；不存在时返回 false */
export async function deleteSiteConfigEntry(pattern: string): Promise<boolean> {
  const idx = entries.findIndex(([p]) => p === pattern);
  if (idx < 0) return false;
  entries.splice(idx, 1);
  await saveSiteConfig();
  return true;
}
