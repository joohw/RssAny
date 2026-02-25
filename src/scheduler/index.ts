// 调度器：根据订阅的 pullInterval 与信源的 refresh 定时触发 getItems，驱动数据持续增量入库

import { watch } from "node:fs";
import { getAllSubscriptionConfigs } from "../subscription/index.js";
import { resolveRef } from "../subscription/types.js";
import { getItems } from "../feeder/index.js";
import { SUBSCRIPTIONS_CONFIG_PATH } from "../config/paths.js";
import type { RefreshInterval } from "../utils/refreshInterval.js";
import { refreshIntervalToMs } from "../utils/refreshInterval.js";


/**
 * 活跃定时器注册表：
 *   key = subscriptionId          → 订阅级定时器（源于 pullInterval，覆盖无 refresh 的信源）
 *   key = subscriptionId::ref     → 单信源独立定时器（源于 SubscriptionSource.refresh）
 */
const timers = new Map<string, NodeJS.Timeout>();


/** 拉取单个信源，携带 refreshInterval 传入 feeder 以统一策略解析 */
async function pullSource(subId: string, ref: string, cacheDir: string, refreshInterval?: RefreshInterval): Promise<void> {
  try {
    await getItems(ref, { cacheDir, refreshInterval, writeDb: true });
    console.log(`[Scheduler] 信源 "${ref}"（订阅 "${subId}"）拉取完成`);
  } catch (err) {
    console.warn(`[Scheduler] 信源 "${ref}" 拉取失败:`, err instanceof Error ? err.message : String(err));
  }
}


/** 拉取单个订阅下所有无独立 refresh 的信源，并发触发 fetch→parse→upsert 全流程 */
async function pullSubscription(id: string, sourceUrls: string[], cacheDir: string, refreshInterval?: RefreshInterval): Promise<void> {
  console.log(`[Scheduler] 开始拉取订阅 "${id}"（${sourceUrls.length} 个信源）`);
  const results = await Promise.allSettled(sourceUrls.map((url) => getItems(url, { cacheDir, refreshInterval, writeDb: true })));
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      ok++;
    } else {
      fail++;
      console.warn(`[Scheduler] 信源拉取失败:`, r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  console.log(`[Scheduler] 订阅 "${id}" 完成：成功 ${ok} 个，失败 ${fail} 个`);
}


/** 清除所有活跃定时器 */
function clearAllTimers(): void {
  for (const [id, timer] of timers) {
    clearInterval(timer);
    timers.delete(id);
  }
}


/** 读取最新订阅配置并重建所有定时器（订阅级 + 单信源级） */
async function reschedule(cacheDir: string): Promise<void> {
  clearAllTimers();
  let configs: Awaited<ReturnType<typeof getAllSubscriptionConfigs>>;
  try {
    configs = await getAllSubscriptionConfigs();
  } catch {
    configs = [];
  }
  let count = 0;
  for (const config of configs) {
    const sourcesWithOwnRefresh = config.sources.filter((s) => !!s.refresh);
    const sourcesWithoutRefresh = config.sources.filter((s) => !s.refresh);
    for (const src of sourcesWithOwnRefresh) {
      const ref = resolveRef(src);
      if (!ref) continue;
      const intervalMs = refreshIntervalToMs(src.refresh!);
      if (!intervalMs) continue;
      const timerKey = `${config.id}::${ref}`;
      const timer = setInterval(() => {
        pullSource(config.id, ref, cacheDir, src.refresh).catch((err) => {
          console.warn(`[Scheduler] 信源 "${ref}" 定时拉取异常:`, err instanceof Error ? err.message : String(err));
        });
      }, intervalMs);
      timers.set(timerKey, timer);
      count++;
      console.log(`[Scheduler] 信源 "${ref}" 已独立调度，间隔 ${src.refresh}`);
    }
    if (!config.pullInterval) continue;
    const intervalMs = refreshIntervalToMs(config.pullInterval);
    if (!intervalMs) continue;
    const subSourceUrls = sourcesWithoutRefresh.map((s) => resolveRef(s)).filter(Boolean);
    if (subSourceUrls.length === 0) continue;
    const timer = setInterval(() => {
      pullSubscription(config.id, subSourceUrls, cacheDir, config.pullInterval).catch((err) => {
        console.warn(`[Scheduler] 订阅 "${config.id}" 定时拉取异常:`, err instanceof Error ? err.message : String(err));
      });
    }, intervalMs);
    timers.set(config.id, timer);
    count++;
    console.log(`[Scheduler] 订阅 "${config.id}" 已调度（${subSourceUrls.length} 个无独立 refresh 信源），间隔 ${config.pullInterval}`);
  }
  console.log(`[Scheduler] 调度完成，共 ${count} 个定时任务`);
}


/** 启动时对所有订阅触发一次后台拉取，预热数据库；不阻塞启动流程 */
function warmUp(cacheDir: string): void {
  getAllSubscriptionConfigs().then((configs) => {
    for (const config of configs) {
      const sourceUrls = config.sources.map((s) => resolveRef(s)).filter(Boolean);
      if (sourceUrls.length === 0) continue;
      pullSubscription(config.id, sourceUrls, cacheDir, config.pullInterval).catch((err) => {
        console.warn(`[Scheduler] 启动预热失败 "${config.id}":`, err instanceof Error ? err.message : String(err));
      });
    }
  }).catch((err) => {
    console.warn("[Scheduler] 启动预热读取配置失败:", err instanceof Error ? err.message : String(err));
  });
}


/** 初始化调度器：启动定时任务，并监听 subscriptions.json 变化自动重调度（防抖 500ms） */
export async function initScheduler(cacheDir = "cache"): Promise<void> {
  await reschedule(cacheDir);
  warmUp(cacheDir);
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(SUBSCRIPTIONS_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log("[Scheduler] 检测到 subscriptions.json 变化，重新调度…");
        reschedule(cacheDir)
          .then(() => warmUp(cacheDir))  // 重调度后立即预热，确保新增信源不需等待第一个周期
          .catch((err) => {
            console.warn("[Scheduler] 重调度失败:", err instanceof Error ? err.message : String(err));
          });
      }, 500);
    });
    watcher.on("error", (err) => {
      console.warn("[Scheduler] 监听 subscriptions.json 出错:", err.message);
    });
  } catch {
    console.warn("[Scheduler] subscriptions.json 尚不存在，跳过文件监听（创建后请重启服务）");
  }
}
