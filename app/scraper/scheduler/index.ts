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
/** warmUp 时最多同时拉取的信源数，避免启动瞬间全量并发 */
const WARMUP_CONCURRENCY = 5;


async function pullSource(ref: string, cacheDir: string, refreshInterval?: RefreshInterval): Promise<void> {
  try {
    await getItems(ref, { cacheDir, refreshInterval: refreshInterval ?? DEFAULT_REFRESH, writeDb: true });
    logger.info("scheduler", "拉取成功", { source_url: ref });
  } catch (err) {
    logger.warn("scheduler", "拉取失败", {
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
  for (const src of sources) {
    const ref = resolveRef(src);
    if (!ref) continue;
    const interval = src.refresh ?? DEFAULT_REFRESH;
    const intervalMs = refreshIntervalToMs(interval);
    if (!intervalMs) continue;
    const timer = setInterval(() => {
      pullSource(ref, cacheDir, src.refresh ?? undefined);
    }, intervalMs);
    timers.set(ref, timer);
  }
}


/** 启动时对所有信源触发一次后台拉取（限制并发，避免一次性过多） */
function warmUp(cacheDir: string): void {
  getAllSources()
    .then((sources) => {
      const refs = sources
        .map((src) => ({ ref: resolveRef(src), refresh: src.refresh as RefreshInterval | undefined }))
        .filter((x): x is { ref: string; refresh: RefreshInterval | undefined } => !!x.ref);
      const runBatch = (start: number): void => {
        if (start >= refs.length) return;
        const batch = refs.slice(start, start + WARMUP_CONCURRENCY);
        Promise.all(
          batch.map(({ ref, refresh }) => pullSource(ref, cacheDir, refresh))
        ).then(() => runBatch(start + batch.length));
      };
      runBatch(0);
    })
    .catch(() => {});
}


export async function initScheduler(cacheDir = "cache"): Promise<void> {
  await reschedule(cacheDir);
  warmUp(cacheDir);
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(SOURCES_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        reschedule(cacheDir).then(() => warmUp(cacheDir)).catch(() => {});
      }, 500);
    });
    watcher.on("error", () => {});
  } catch {
    // sources.json 尚不存在，跳过文件监听
  }
}
