// 话题报告调度：每个 topic 独立调度（与 sources 类似），复用通用调度器
// 使用 cron 表达式，固定每天 4 点执行，与服务器启动时间解耦

import { watch } from "node:fs";
import * as scheduler from "../scheduler/index.js";
import { generateTopicDigest } from "./index.js";
import { getAgentTasks } from "../db/index.js";
import { TASKS_CONFIG_PATH } from "../config/paths.js";
import { logger } from "../core/logger/index.js";


const TOPICS_GROUP = "topics";
/** Agent 任务组最大并发数 */
const TOPICS_CONCURRENCY = 1;
/** 默认执行时刻（小时，0–23），本地时间 */
const DEFAULT_SCHEDULE_HOUR = 4;


function topicTaskId(title: string): string {
  return `topic:${title}`;
}


function createTopicTask(baseDir: string, topicTitle: string): scheduler.ScheduledTask {
  return async () => {
    await generateTopicDigest(baseDir, topicTitle, false);
  };
}


/**
 * 将 refresh 天数转为 cron 表达式（本地时间）
 * refresh 1 → 每天 4:00；7 → 每周日 4:00；其他 → 每月每隔 N 天 4:00（如 3 → 1,4,7,10...）
 */
function refreshDaysToCron(refreshDays: number, hour: number): string {
  const h = Math.max(0, Math.min(23, hour));
  const m = "0";
  if (refreshDays === 1) return `${m} ${h} * * *`;
  if (refreshDays === 7) return `${m} ${h} * * 0`;
  const n = Math.min(31, Math.max(2, refreshDays));
  return `${m} ${h} 1-31/${n} * *`;
}


/** 读取 tasks.json 并为每个任务注册独立定时调度（cron，本地时间） */
async function rescheduleTopics(baseDir: string, runNow: boolean): Promise<void> {
  scheduler.unscheduleGroup(TOPICS_GROUP);

  let topics: Awaited<ReturnType<typeof getAgentTasks>>;
  try {
    topics = await getAgentTasks();
  } catch {
    topics = [];
  }

  for (const t of topics) {
    const title = t.title.trim();
    if (!title) continue;
    const refreshDays = Math.max(1, t.refresh ?? 1);
    const cronExpr = refreshDaysToCron(refreshDays, DEFAULT_SCHEDULE_HOUR);

    scheduler.schedule(TOPICS_GROUP, topicTaskId(title), createTopicTask(baseDir, title), {
      cron: cronExpr,
      retries: 1,
      retryDelayMs: 60_000,
      concurrency: TOPICS_CONCURRENCY,
      runNow,
    });
  }

  logger.info("scheduler", "Agent 任务调度已注册", { count: topics.length });
}


export async function initTopicsScheduler(baseDir: string): Promise<void> {
  await rescheduleTopics(baseDir, false);

  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(TASKS_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        rescheduleTopics(baseDir, true).catch(() => {});
      }, 500);
    });
    watcher.on("error", () => {});
  } catch {
    // tasks.json 尚不存在，跳过文件监听
  }
}
