// 日报调度：Daily = topic/日期，调用 topics.generateDigest

import * as scheduler from "../scheduler/index.js";
import { generateDigest } from "../topics/index.js";
import { todayDate } from "./index.js";
import { logger } from "../core/logger/index.js";


const DAILY_GROUP = "daily";
/** 每天 3:00 生成日报 */
const DAILY_CRON = process.env.DAILY_CRON ?? "0 3 * * *";


function createDailyTask(cacheDir: string): scheduler.ScheduledTask {
  return async () => {
    try {
      const result = await generateDigest(cacheDir, todayDate(), false);
      if (!result.skipped) {
        logger.info("daily", "定时日报生成完成", { date: result.key });
      }
    } catch (err) {
      logger.error("daily", "定时日报生成失败", {
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}


export function initDailyScheduler(cacheDir: string): void {
  scheduler.registerGroup(DAILY_GROUP, 1);

  if (!scheduler.validateCron(DAILY_CRON)) {
    logger.warn("daily", "DAILY_CRON 表达式无效，跳过日报调度", { cron: DAILY_CRON });
    return;
  }

  scheduler.schedule("daily-digest", DAILY_CRON, createDailyTask(cacheDir), {
    retries: 1,
    retryDelayMs: 60_000,
    group: DAILY_GROUP,
    runNow: false,
  });

  logger.info("daily", "日报调度已注册", { cron: DAILY_CRON });
}
