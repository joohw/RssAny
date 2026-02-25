// 日志配置：从环境变量读取，不依赖 config.json 以尽早可用

import type { LogLevel } from "./types.js";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function parseLevel(s: string | undefined, fallback: LogLevel): LogLevel {
  if (!s) return fallback;
  const v = s.toLowerCase() as LogLevel;
  if (LEVEL_ORDER.includes(v)) return v;
  return fallback;
}

/** 当前控制台最低输出级别（默认 info，生产可设为 warn） */
export function getConsoleLevel(): LogLevel {
  return parseLevel(process.env.LOG_LEVEL, "info");
}

/** 是否将 error/warn 写入数据库（默认 true） */
export function getLogToDb(): boolean {
  const v = process.env.LOG_TO_DB;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

/** 落库的最低级别（默认 warn） */
export function getDbLevel(): LogLevel {
  return parseLevel(process.env.LOG_DB_LEVEL, "warn");
}

export function levelOrder(l: LogLevel): number {
  return LEVEL_ORDER.indexOf(l);
}

/** 是否应输出到控制台 */
export function shouldLogToConsole(consoleLevel: LogLevel, entryLevel: LogLevel): boolean {
  return levelOrder(entryLevel) >= levelOrder(consoleLevel);
}

/** 是否应写入 DB */
export function shouldLogToDb(logToDb: boolean, dbLevel: LogLevel, entryLevel: LogLevel): boolean {
  return logToDb && levelOrder(entryLevel) >= levelOrder(dbLevel);
}
