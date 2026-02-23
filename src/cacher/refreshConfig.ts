// 刷新间隔配置：从 refresh.json 加载，支持按站点 ID 或 URL 正则匹配

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheKeyStrategy } from "../fetcher/types.js";


/** 刷新间隔类型：排除 forever，仅允许有时间语义的策略 */
export type RefreshInterval = Exclude<CacheKeyStrategy, "forever">;


/** 所有合法的刷新间隔值 */
const VALID_INTERVALS: RefreshInterval[] = ["10min", "30min", "1h", "6h", "12h", "1day", "3day", "7day"];


/** 刷新间隔配置映射表：key 为站点 ID 或 URL 正则表达式 */
let refreshMap: Record<string, string> = {};


/** 已编译的正则表达式缓存 */
const regexCache = new Map<string, RegExp>();


/** 编译正则表达式（带缓存），失败返回 null */
function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  try {
    const regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
    return regex;
  } catch {
    return null;
  }
}


/** 根据站点 ID 或 URL 获取刷新间隔，默认返回 1day */
export function getRefreshStrategy(siteId: string, url?: string): RefreshInterval {
  const byId = refreshMap[siteId];
  if (byId && (VALID_INTERVALS as string[]).includes(byId)) return byId as RefreshInterval;
  if (url) {
    for (const [pattern, interval] of Object.entries(refreshMap)) {
      if (pattern === siteId) continue;
      const regex = compileRegex(pattern);
      if (regex && regex.test(url) && (VALID_INTERVALS as string[]).includes(interval)) {
        return interval as RefreshInterval;
      }
    }
  }
  return "1day";
}


/** 加载 refresh.json 配置文件 */
export async function loadRefreshConfig(configPath?: string): Promise<void> {
  const path = configPath ?? join(process.cwd(), "refresh.json");
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      refreshMap = Object.fromEntries(
        Object.entries(parsed).filter(([k]) => !k.startsWith("$"))
      ) as Record<string, string>;
      regexCache.clear();
      console.log(`[Refresh] 已加载 ${Object.keys(refreshMap).length} 条刷新间隔配置`);
    } else {
      console.warn("[Refresh] refresh.json 格式无效，应为对象");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[Refresh] refresh.json 不存在，使用默认值（1day）");
    } else {
      console.warn("[Refresh] 加载配置失败:", err instanceof Error ? err.message : String(err));
    }
    refreshMap = {};
  }
}


/** 获取当前刷新间隔配置（用于调试） */
export function getRefreshMap(): Readonly<Record<string, string>> {
  return { ...refreshMap };
}
