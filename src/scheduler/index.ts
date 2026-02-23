// 调度器：根据订阅的 pullInterval 定时触发 getItems，驱动数据持续增量入库

import { watch } from "node:fs";
import { getAllSubscriptionConfigs } from "../subscription/index.js";
import { getItems } from "../feeder/index.js";
import { SUBSCRIPTIONS_CONFIG_PATH } from "../config/paths.js";
import type { RefreshInterval } from "../sites/siteConfig.js";


/** 各 pullInterval 对应的毫秒数 */
const INTERVAL_MS: Record<RefreshInterval, number> = {
  "10min": 10 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1day": 24 * 60 * 60 * 1000,
  "3day": 3 * 24 * 60 * 60 * 1000,
  "7day": 7 * 24 * 60 * 60 * 1000,
};


/** 当前活跃的定时器：key = subscriptionId */
const timers = new Map<string, NodeJS.Timeout>();


/** 拉取单个订阅下的所有信源，并发调用 getItems 触发 fetch→parse→upsert 全流程 */
async function pullSubscription(id: string, sourceUrls: string[], cacheDir: string): Promise<void> {
  console.log(`[Scheduler] 开始拉取订阅 "${id}"（${sourceUrls.length} 个信源）`);
  const results = await Promise.allSettled(sourceUrls.map((url) => getItems(url, { cacheDir })));
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


/** 读取最新订阅配置并重建所有定时器 */
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
    if (!config.pullInterval) continue;
    const intervalMs = INTERVAL_MS[config.pullInterval];
    if (!intervalMs) continue;
    const sourceUrls = config.sources.map((s) => s.url);
    const timer = setInterval(() => {
      pullSubscription(config.id, sourceUrls, cacheDir).catch((err) => {
        console.warn(`[Scheduler] 订阅 "${config.id}" 定时拉取异常:`, err instanceof Error ? err.message : String(err));
      });
    }, intervalMs);
    timers.set(config.id, timer);
    count++;
    console.log(`[Scheduler] 订阅 "${config.id}" 已调度，间隔 ${config.pullInterval}`);
  }
  console.log(`[Scheduler] 调度完成，共 ${count} 个订阅启用定时拉取`);
}


/** 初始化调度器：启动定时任务，并监听 subscriptions.json 变化自动重调度（防抖 500ms） */
export async function initScheduler(cacheDir = "cache"): Promise<void> {
  await reschedule(cacheDir);
  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(SUBSCRIPTIONS_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log("[Scheduler] 检测到 subscriptions.json 变化，重新调度…");
        reschedule(cacheDir).catch((err) => {
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
