// 话题报告调度：定时为所有追踪话题生成报告，复用通用调度器

import * as scheduler from "../scheduler/index.js";
import { generateAllTopicDigests } from "./index.js";
import { logger } from "../core/logger/index.js";


const TOPICS_GROUP = "topics";
/** 每天 4:00 生成各话题报告（在日报之后） */
const TOPICS_CRON = process.env.TOPICS_CRON ?? "0 4 * * *";


function createTopicsTask(cacheDir: string): scheduler.ScheduledTask {
  return async () => {
    try {
      await generateAllTopicDigests(cacheDir);
      logger.info("topics", "定时话题报告生成完成");
    } catch (err) {
      logger.error("topics", "定时话题报告生成失败", {
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}


export function initTopicsScheduler(cacheDir: string): void {
  scheduler.registerGroup(TOPICS_GROUP, 1);

  if (!scheduler.validateCron(TOPICS_CRON)) {
    logger.warn("topics", "TOPICS_CRON 表达式无效，跳过话题调度", { cron: TOPICS_CRON });
    return;
  }

  scheduler.schedule("topics-digest", TOPICS_CRON, createTopicsTask(cacheDir), {
    retries: 1,
    retryDelayMs: 60_000,
    group: TOPICS_GROUP,
    runNow: false,
  });

  logger.info("topics", "话题报告调度已注册", { cron: TOPICS_CRON });
}
