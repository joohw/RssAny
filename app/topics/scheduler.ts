// 话题报告调度：每个 topic 独立调度（与 sources 类似），复用通用调度器

import { watch } from "node:fs";
import * as scheduler from "../scheduler/index.js";
import { generateTopicDigest } from "./index.js";
import { getTopics } from "../db/index.js";
import { TOPICS_CONFIG_PATH } from "../config/paths.js";
import { logger } from "../core/logger/index.js";


const TOPICS_GROUP = "topics";
/** topics 组最大并发数 */
const TOPICS_CONCURRENCY = 1;


function topicTaskId(title: string): string {
  return `topic:${title}`;
}


function createTopicTask(cacheDir: string, topicTitle: string): scheduler.ScheduledTask {
  return async () => {
    try {
      await generateTopicDigest(cacheDir, topicTitle, false);
      logger.info("topics", "话题报告生成完成", { topic: topicTitle });
    } catch (err) {
      logger.error("topics", "话题报告生成失败", {
        topic: topicTitle,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}


/** 读取 topics.json 并为每个话题注册独立定时任务 */
async function rescheduleTopics(cacheDir: string, runNow: boolean): Promise<void> {
  scheduler.unscheduleGroup(TOPICS_GROUP);
  scheduler.registerGroup(TOPICS_GROUP, TOPICS_CONCURRENCY);

  let topics: Awaited<ReturnType<typeof getTopics>>;
  try {
    topics = await getTopics();
  } catch {
    topics = [];
  }

  for (const t of topics) {
    const title = t.title.trim();
    if (!title) continue;
    const refreshDays = Math.max(1, t.refresh ?? 1);
    const intervalMs = refreshDays * 24 * 60 * 60 * 1000;

    scheduler.schedule(topicTaskId(title), intervalMs, createTopicTask(cacheDir, title), {
      retries: 1,
      retryDelayMs: 60_000,
      group: TOPICS_GROUP,
      runNow,
    });
  }

  logger.info("topics", "话题报告调度已注册", { count: topics.length });
}


export async function initTopicsScheduler(cacheDir: string): Promise<void> {
  await rescheduleTopics(cacheDir, false);

  let debounceTimer: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(TOPICS_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        rescheduleTopics(cacheDir, true).catch(() => {});
      }, 500);
    });
    watcher.on("error", () => {});
  } catch {
    // topics.json 尚不存在，跳过文件监听
  }
}
