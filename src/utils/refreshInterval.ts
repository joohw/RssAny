// RefreshInterval：类型定义 + interval → ms 转换，供全项目共用

import type { CacheKeyStrategy } from "../sources/web/fetcher/types.js";


/** 刷新间隔类型（有时间语义的缓存策略，排除 forever） */
export type RefreshInterval = Exclude<CacheKeyStrategy, "forever">;


/** 合法的刷新间隔值列表（用于运行时校验） */
export const VALID_INTERVALS: RefreshInterval[] = ["10min", "30min", "1h", "6h", "12h", "1day", "3day", "7day"];


/** 将 RefreshInterval 转换为对应的毫秒数 */
export function refreshIntervalToMs(interval: RefreshInterval): number {
  const map: Record<RefreshInterval, number> = {
    "10min": 10 * 60 * 1000,
    "30min": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "1day": 24 * 60 * 60 * 1000,
    "3day": 3 * 24 * 60 * 60 * 1000,
    "7day": 7 * 24 * 60 * 60 * 1000,
  };
  return map[interval];
}
