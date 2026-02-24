// Enrich 配置加载：从 .rssany/config.json 读取并发与重试设置，支持环境变量兜底

import { readFile } from "node:fs/promises";
import { USER_DIR } from "../config/paths.js";
import { join } from "node:path";
import type { EnrichConfig } from "./types.js";


/** 默认配置 */
const DEFAULTS: EnrichConfig = {
  concurrency: 2,
  maxRetries: 2,
};


/** 读取 .rssany/config.json 中的 enrich 块，缺失字段用环境变量或默认值补全 */
export async function loadEnrichConfig(): Promise<EnrichConfig> {
  let fileEnrich: Record<string, unknown> = {};
  try {
    const raw = await readFile(join(USER_DIR, "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.enrich && typeof parsed.enrich === "object") {
      fileEnrich = parsed.enrich as Record<string, unknown>;
    }
  } catch {
    // 文件不存在或解析失败时使用默认值
  }
  return {
    concurrency: Number(fileEnrich["concurrency"] ?? process.env.ENRICH_CONCURRENCY ?? DEFAULTS.concurrency),
    maxRetries: Number(fileEnrich["maxRetries"] ?? process.env.ENRICH_MAX_RETRIES ?? DEFAULTS.maxRetries),
  };
}
