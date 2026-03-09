// Enrich：使用通用调度器的 enrich 分组执行正文提取，复用分组并发

import { randomUUID } from "node:crypto";
import type { FeedItem } from "../../types/feedItem.js";
import type { SourceContext } from "../sources/types.js";
import type { EnrichTask, EnrichItemResult, EnrichConfig, EnrichFn, EnrichSubmitOptions } from "./types.js";
import { loadEnrichConfig } from "./config.js";
import { logger } from "../../core/logger/index.js";
import * as scheduler from "../../scheduler/index.js";


const ENRICH_GROUP = "enrich";
const MAX_STORED_TASKS = 200;
const RETRY_DELAY_MS = 3000;


class EnrichQueue {
  private tasks = new Map<string, EnrichTask>();
  private taskItems = new Map<string, FeedItem[]>();
  private taskCallbacks = new Map<string, EnrichSubmitOptions>();
  private configLoaded = false;


  private async ensureConfig(): Promise<EnrichConfig> {
    if (this.configLoaded) return { concurrency: 2, maxRetries: 2 };
    const config = await loadEnrichConfig();
    this.configLoaded = true;
    logger.info("enrich", "配置加载完成", { concurrency: config.concurrency, maxRetries: config.maxRetries });
    return config;
  }


  private evictIfNeeded(): void {
    if (this.tasks.size <= MAX_STORED_TASKS) return;
    const ids = [...this.tasks.keys()];
    for (const id of ids) {
      if (this.tasks.get(id)?.status === "done") {
        this.removeTask(id);
        if (this.tasks.size <= MAX_STORED_TASKS) return;
      }
    }
    if (this.tasks.size > MAX_STORED_TASKS) this.removeTask(ids[0]);
  }


  private removeTask(id: string): void {
    this.tasks.delete(id);
    this.taskItems.delete(id);
    this.taskCallbacks.delete(id);
  }


  private checkTaskComplete(taskId: string): void {
    const task = this.tasks.get(taskId);
    const items = this.taskItems.get(taskId);
    const callbacks = this.taskCallbacks.get(taskId);
    if (!task || !items) return;
    const allSettled = task.itemResults.every((r) => r.status === "done" || r.status === "failed");
    if (!allSettled) return;
    task.status = "done";
    task.completedAt = new Date().toISOString();
    logger.info("enrich", "任务完成", {
      source_url: task.sourceUrl,
      taskId,
      done: task.progress.done,
      failed: task.progress.failed,
    });
    Promise.resolve(callbacks?.onAllDone?.(items)).catch((err) => {
      logger.warn("enrich", "onAllDone 回调异常", { taskId, err: err instanceof Error ? err.message : String(err) });
    });
  }


  async submit(items: FeedItem[], enrichFn: EnrichFn, ctx: SourceContext, opts: EnrichSubmitOptions): Promise<string> {
    const config = await this.ensureConfig();
    const id = randomUUID();
    const itemResults: EnrichItemResult[] = items.map((_, i) => ({
      index: i,
      status: "pending",
      retries: 0,
    }));
    const task: EnrichTask = {
      id,
      sourceUrl: opts.sourceUrl,
      status: items.length === 0 ? "done" : "pending",
      progress: { total: items.length, done: 0, failed: 0 },
      itemResults,
      createdAt: new Date().toISOString(),
      completedAt: items.length === 0 ? new Date().toISOString() : undefined,
    };
    const itemsCopy = [...items];
    this.tasks.set(id, task);
    this.taskItems.set(id, itemsCopy);
    this.taskCallbacks.set(id, opts);
    this.evictIfNeeded();

    for (let i = 0; i < items.length; i++) {
      const itemIndex = i;
      const workId = `${id}-${i}`;
      const taskFn: scheduler.ScheduledTask = async () => {
        const t = this.tasks.get(id);
        const its = this.taskItems.get(id);
        const cbs = this.taskCallbacks.get(id);
        if (!t || !its || !cbs) return;
        const itemResult = t.itemResults[itemIndex];
        if (!itemResult) return;
        itemResult.status = "running";
        if (t.status === "pending") t.status = "running";

        for (let r = 0; r <= config.maxRetries; r++) {
          try {
            const enriched = await enrichFn(its[itemIndex], ctx);
            its[itemIndex] = enriched;
            itemResult.item = enriched;
            itemResult.status = "done";
            t.progress.done++;
            await Promise.resolve(cbs.onItemDone?.(enriched, itemIndex));
            this.checkTaskComplete(id);
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (r < config.maxRetries) {
              logger.warn("enrich", "提取失败，重试中", {
                source_url: t.sourceUrl,
                item_url: its[itemIndex]?.link,
                retries: r + 1,
                maxRetries: config.maxRetries,
                err: msg,
              });
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
              itemResult.status = "failed";
              itemResult.error = msg;
              t.progress.failed++;
              logger.warn("enrich", "提取最终失败", {
                source_url: t.sourceUrl,
                item_url: its[itemIndex]?.link,
                err: msg,
              });
              const failedItem = { ...its[itemIndex], enrichFailed: true };
              its[itemIndex] = failedItem;
              await Promise.resolve(cbs.onItemDone?.(failedItem, itemIndex));
              this.checkTaskComplete(id);
            }
          }
        }
      };
      scheduler.schedule(ENRICH_GROUP, workId, taskFn, { concurrency: config.concurrency }).catch(() => {});
    }
    return id;
  }


  getTask(id: string): EnrichTask | undefined {
    return this.tasks.get(id);
  }


  getTaskItems(id: string): FeedItem[] | undefined {
    return this.taskItems.get(id);
  }
}


export const enrichQueue = new EnrichQueue();
