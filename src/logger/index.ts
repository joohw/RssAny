// 统一日志：按级别输出到控制台，error/warn 可落库，不把一切打满控制台

import { insertLog } from "../db/index.js";
import {
  getConsoleLevel,
  getLogToDb,
  getDbLevel,
  shouldLogToConsole,
  shouldLogToDb,
} from "./config.js";
import type { LogCategory, LogEntry, LogLevel } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function formatConsole(entry: LogEntry): string {
  const tag = `[${entry.category}]`;
  const payloadStr =
    entry.payload != null && Object.keys(entry.payload).length > 0
      ? " " + JSON.stringify(entry.payload)
      : "";
  return `${tag} ${entry.message}${payloadStr}`;
}

function writeConsole(entry: LogEntry): void {
  const line = formatConsole(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
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

  const consoleLevel = getConsoleLevel();
  if (shouldLogToConsole(consoleLevel, level)) {
    writeConsole(entry);
  }

  if (shouldLogToDb(getLogToDb(), getDbLevel(), level)) {
    writeDb(entry);
  }
}

/** 统一 logger：error/warn 可落库，控制台由 LOG_LEVEL 过滤 */
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
