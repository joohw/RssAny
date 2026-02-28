// 调度器：根据 sources.json 中的信源 refresh 定时触发 getItems，驱动数据持续增量入库

import { watch } from "node:fs";
import { getAllSources } from "../subscription/index.js";
import { resolveRef } from "../subscription/types.js";
import { getItems } from "../../feeder/index.js";
import { SOURCES_CONFIG_PATH } from "../../config/paths.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";
import { refreshIntervalToMs } from "../../utils/refreshInterval.js";
import { logger } from "../../core/logger/index.js";


const DEFAULT_REFRESH: RefreshInterval = "1day";
const timers = new Map<string, NodeJS.Timeout>();


async function pullSource(ref: string, cacheDir: string, refreshInterval?: RefreshInterval): Promise<void> {
  try {
    await getItems(ref, { cacheDir, refreshInterval: refreshInterval ?? DEFAULT_REFRESH, writeDb: true });
    logger.info("scheduler", "信源拉取完成", { source_url: ref });
  } catch (err) {
    logger.warn("scheduler", "信源拉取失败", {
      source_url: ref,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}


function clearAllTimers(): void {
  for (const [, timer] of timers) {
    clearInterval(timer);
  }
  timers.clear();
}


/** 读取 sources.json 扁平列表并重建定时器（每个信源按 refresh 独立调度） */
async function reschedule(cacheDir: string): Promise<void> {
  clearAllTimers();
  let sources: Awaited<ReturnType<typeof getAllSources>>;
  try {
    sources = await getAllSources();
  } catch {
    sources = [];
  }
  let count = 0;
  for (const src of sources) {
    const ref = resolveRef(src);
    if (!ref) continue;
    const interval = src.refresh ?? DEFAULT_REFRESH;
    const intervalMs = refreshIntervalToMs(interval);
    if (!intervalMs) continue;
    const timer = setInterval(() => {
      pullSource(ref, cacheDir, src.refresh ?? undefined).catch((err) => {
        logger.warn("scheduler", "信源定时拉取异常", {
          source_url: ref,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    timers.set(ref, timer);
    count++;
    logger.info("scheduler", "信源已调度", { source_url: ref, refresh: interval });
  }
  logger.info("scheduler", "调度完成", { sourceCount: count });
}


/** 启动时对所有信源触发一次后台拉取 */
function warmUp(cacheDir: string): void {
  getAllSources()
    .then((sources) => {
      for (const src of sources) {
        const ref = resolveRef(src);
        if (!ref) continue;
        pullSource(ref, cacheDir, src.refresh ?? undefined).catch((err) => {
          logger.warn("scheduler", "启动预热失败", {
            source_url: ref,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
    })
    .catch((err) => {
      logger.warn("scheduler", "读取 sources.json 失败", { err: err instanceof Error ? err.message : String(err) });
    });
}


export async function initScheduler(cacheDir = "cache"): Promise<void> {
  await reschedule(cacheDir);
  warmUp(cacheDir);
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(SOURCES_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        logger.info("scheduler", "检测到 sources.json 变化，重新调度");
        reschedule(cacheDir)
          .then(() => warmUp(cacheDir))
          .catch((err) => {
            logger.warn("scheduler", "重调度失败", { err: err instanceof Error ? err.message : String(err) });
          });
      }, 500);
    });
    watcher.on("error", (err) => {
      logger.warn("scheduler", "监听 sources.json 出错", { err: err.message });
    });
  } catch {
    logger.warn("scheduler", "sources.json 尚不存在，跳过文件监听（创建后请重启服务）");
  }
}
