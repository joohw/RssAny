// RefreshInterval：类型定义 + interval → ms 转换，供全项目共用

import type { CacheKeyStrategy } from "../scraper/sources/web/fetcher/types.js";


/** 刷新间隔类型（有时间语义的缓存策略，排除 forever） */
export type RefreshInterval = Exclude<CacheKeyStrategy, "forever">;


/** 合法的刷新间隔值列表（用于运行时校验） */
export const VALID_INTERVALS: RefreshInterval[] = ["1min", "5min", "10min", "30min", "1h", "6h", "12h", "1day", "3day", "7day"];


/**
 * 从 cron 表达式推断缓存策略，使缓存 key 与执行频率一致
 * 格式：minute hour day month weekday（5 字段）或 second minute hour day month weekday（6 字段）
 */
export function cronToRefreshInterval(cronExpr: string): RefreshInterval {
  const parts = cronExpr.trim().split(/\s+/);
  const is6Field = parts.length >= 6;
  const minute = parts[is6Field ? 1 : 0];
  const hour = parts[is6Field ? 2 : 1];
  const day = parts[is6Field ? 3 : 2];
  const weekday = parts[is6Field ? 5 : 4];

  // 分钟级：*/N 或 *
  const minMatch = minute.match(/^\*\/(\d+)$/);
  if (minute === "*" || (minMatch && parseInt(minMatch[1], 10) <= 1)) return "1min";
  if (minMatch) {
    const n = parseInt(minMatch[1], 10);
    if (n <= 5) return "5min";
    if (n <= 10) return "10min";
    if (n <= 30) return "30min";
  }

  // 小时级：minute=0, hour=*/N 或 *
  if (minute === "0" || minute === "00") {
    const hourMatch = hour.match(/^\*\/(\d+)$/);
    if (hour === "*" || (hourMatch && parseInt(hourMatch[1], 10) <= 1)) return "1h";
    if (hourMatch) {
      const n = parseInt(hourMatch[1], 10);
      if (n <= 2) return "1h";
      if (n <= 6) return "6h";
      if (n <= 12) return "12h";
    }
    // 每天固定时刻（如 0 9 * * *）
    if (day === "*" || day === "?") return "1day";
    // 每周固定时刻（如 0 0 * * 0）
    if (weekday !== "*" && weekday !== "?") return "7day";
  }

  return "1h";
}


/** 将 RefreshInterval 转换为对应的毫秒数 */
export function refreshIntervalToMs(interval: RefreshInterval): number {
  const map: Record<RefreshInterval, number> = {
    "1min": 1 * 60 * 1000,
    "5min": 5 * 60 * 1000,
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
