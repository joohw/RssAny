// 信源调度：根据 sources.json 中的信源 refresh 定时触发 getItems，使用通用调度器

import { watch } from "node:fs";
import { getAllSources } from "../subscription/index.js";
import { resolveRef } from "../subscription/types.js";
import { getItems } from "../../feeder/index.js";
import { SOURCES_CONFIG_PATH } from "../../config/paths.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";
import { refreshIntervalToCron } from "../../utils/refreshInterval.js";
import * as scheduler from "../../scheduler/index.js";
import { logger } from "../../core/logger/index.js";


const DEFAULT_REFRESH: RefreshInterval = "1day";
/** sources 组最大并发数 */
const SOURCES_CONCURRENCY = 5;


function createPullTask(ref: string, cacheDir: string, cronExpr: string): scheduler.ScheduledTask {
  return async () => {
    try {
      await getItems(ref, {
        cacheDir,
        cron: cronExpr,
        writeDb: true,
      });
      logger.info("source", "拉取成功", { source_url: ref });
    } catch (err) {
      logger.warn("source", "拉取失败", {
        source_url: ref,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}


/** 信源拉取与 HTTP 预览/rss 共享的并发组，避免超过浏览器/代理限制 */
export const SOURCES_GROUP = "sources";

/** 读取 sources.json 扁平列表并重建定时器（每个信源按 refresh 独立调度） */
async function rescheduleSources(cacheDir: string, runNow: boolean): Promise<void> {
  scheduler.unscheduleGroup(SOURCES_GROUP);
  let sources: Awaited<ReturnType<typeof getAllSources>>;
  try {
    sources = await getAllSources();
  } catch {
    sources = [];
  }
  for (const src of sources) {
    const ref = resolveRef(src);
    if (!ref) continue;
    const cronExpr: string = src.cron
      ? src.cron
      : refreshIntervalToCron(src.refresh ?? DEFAULT_REFRESH);
    if (!scheduler.validateCron(cronExpr)) continue;
    scheduler.schedule(SOURCES_GROUP, ref, createPullTask(ref, cacheDir, cronExpr), {
      cron: cronExpr,
      retries: 2,
      retryDelayMs: 5000,
      concurrency: SOURCES_CONCURRENCY,
      runNow,
    });
  }
}


export async function initScheduler(cacheDir: string): Promise<void> {
  await rescheduleSources(cacheDir, false);
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(SOURCES_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        rescheduleSources(cacheDir, true).catch(() => {});
      }, 500);
    });
    watcher.on("error", () => {});
  } catch {
    // sources.json 尚不存在，跳过文件监听
  }
}
