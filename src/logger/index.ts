// 统一日志：仅落库，不打印控制台；全体级别落库，由日志页/API 查看

import { insertLog } from "../db/index.js";
import { getLogToDb } from "./config.js";
import type { LogCategory, LogEntry, LogLevel } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function writeDb(entry: LogEntry): void {
  insertLog(entry).catch((err) => {
    // 落库失败只打一次 stderr，避免循环
    process.stderr.write(`[logger] 写入日志表失败: ${err instanceof Error ? err.message : String(err)}\n`);
  });
}

function emit(level: LogLevel, category: LogCategory, message: string, meta?: { source_url?: string; [k: string]: unknown }): void {
  const source_url = meta?.source_url;
  const payload = meta && Object.keys(meta).length > 0 ? { ...meta } : undefined;
  if (payload?.source_url !== undefined) delete payload.source_url;
  const entry: LogEntry = {
    level,
    category,
    message,
    payload: payload && Object.keys(payload).length > 0 ? payload : undefined,
    source_url,
    created_at: now(),
  };

  if (getLogToDb()) {
    writeDb(entry);
  }
}

/** 统一 logger：仅落库，不输出控制台；全体级别落库 */
export const logger = {
  error(category: LogCategory, message: string, meta?: { source_url?: string; [k: string]: unknown }) {
    emit("error", category, message, meta);
  },
  warn(category: LogCategory, message: string, meta?: { source_url?: string; [k: string]: unknown }) {
    emit("warn", category, message, meta);
  },
  info(category: LogCategory, message: string, meta?: { source_url?: string; [k: string]: unknown }) {
    emit("info", category, message, meta);
  },
  debug(category: LogCategory, message: string, meta?: { source_url?: string; [k: string]: unknown }) {
    emit("debug", category, message, meta);
  },
};
