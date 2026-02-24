// EnrichQueue：全局异步提取任务队列，支持并发控制、失败重试、任务状态查询

import { randomUUID } from "node:crypto";
import type { FeedItem } from "../types/feedItem.js";
import type { SourceContext } from "../sources/types.js";
import type { EnrichTask, EnrichItemResult, EnrichConfig, EnrichFn, EnrichSubmitOptions } from "./types.js";
import { loadEnrichConfig } from "./config.js";


/** 内部待执行工作单元 */
interface PendingWork {
  taskId: string;
  itemIndex: number;
  retries: number;
}


/** 任务内存上限：超出时从最旧的已完成任务开始淘汰 */
const MAX_STORED_TASKS = 200;


class EnrichQueue {
  private tasks = new Map<string, EnrichTask>();
  private taskItems = new Map<string, FeedItem[]>();
  private taskEnrichFns = new Map<string, EnrichFn>();
  private taskCtxs = new Map<string, SourceContext>();
  private taskCallbacks = new Map<string, EnrichSubmitOptions>();
  private pendingWork: PendingWork[] = [];
  private running = 0;
  private config: EnrichConfig = { concurrency: 2, maxRetries: 2 };
  private configLoaded = false;


  /** 懒加载配置：首次 submit 时读取，后续不再重复读 */
  private async ensureConfig(): Promise<void> {
    if (this.configLoaded) return;
    this.config = await loadEnrichConfig();
    this.configLoaded = true;
    console.log(`[EnrichQueue] 配置加载完成：并发=${this.config.concurrency} 重试=${this.config.maxRetries}`);
  }


  /** 提交一批条目的提取任务，立即返回 taskId；队列满时淘汰旧任务 */
  async submit(items: FeedItem[], enrichFn: EnrichFn, ctx: SourceContext, opts: EnrichSubmitOptions): Promise<string> {
    await this.ensureConfig();
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
    this.tasks.set(id, task);
    this.taskItems.set(id, [...items]);
    this.taskEnrichFns.set(id, enrichFn);
    this.taskCtxs.set(id, ctx);
    this.taskCallbacks.set(id, opts);
    this.evictIfNeeded();
    for (let i = 0; i < items.length; i++) {
      this.enqueue({ taskId: id, itemIndex: i, retries: 0 });
    }
    return id;
  }


  /** 内存淘汰：优先删除已完成任务，若仍超限则删除最旧条目 */
  private evictIfNeeded(): void {
    if (this.tasks.size <= MAX_STORED_TASKS) return;
    const ids = [...this.tasks.keys()];
    for (const id of ids) {
      if (this.tasks.get(id)?.status === "done") {
        this.removeTask(id);
        if (this.tasks.size <= MAX_STORED_TASKS) return;
      }
    }
    if (this.tasks.size > MAX_STORED_TASKS) {
      this.removeTask(ids[0]);
    }
  }


  /** 清除任务的所有关联数据 */
  private removeTask(id: string): void {
    this.tasks.delete(id);
    this.taskItems.delete(id);
    this.taskEnrichFns.delete(id);
    this.taskCtxs.delete(id);
    this.taskCallbacks.delete(id);
  }


  /** 入队并触发 drain */
  private enqueue(work: PendingWork): void {
    this.pendingWork.push(work);
    this.drain();
  }


  /** 消费队列：在并发上限内不断取出工作单元执行 */
  private drain(): void {
    while (this.running < this.config.concurrency && this.pendingWork.length > 0) {
      const work = this.pendingWork.shift()!;
      this.running++;
      this.processItem(work.taskId, work.itemIndex, work.retries)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }


  /** 执行单条目提取；失败时按剩余重试次数决定重入队或标记失败 */
  private async processItem(taskId: string, itemIndex: number, retries: number): Promise<void> {
    const task = this.tasks.get(taskId);
    const items = this.taskItems.get(taskId);
    const enrichFn = this.taskEnrichFns.get(taskId);
    const ctx = this.taskCtxs.get(taskId);
    const callbacks = this.taskCallbacks.get(taskId);
    if (!task || !items || !enrichFn || !ctx) return;
    const itemResult = task.itemResults[itemIndex];
    if (!itemResult) return;
    itemResult.status = "running";
    itemResult.retries = retries;
    if (task.status === "pending") task.status = "running";
    try {
      const enriched = await enrichFn(items[itemIndex], ctx);
      items[itemIndex] = enriched;
      itemResult.item = enriched;
      itemResult.status = "done";
      task.progress.done++;
      await Promise.resolve(callbacks?.onItemDone?.(enriched, itemIndex));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (retries < this.config.maxRetries) {
        itemResult.status = "pending";
        console.warn(`[EnrichQueue] 提取失败，${retries + 1}/${this.config.maxRetries} 次重试 ${items[itemIndex]?.link ?? ""}:`, message);
        this.enqueue({ taskId, itemIndex, retries: retries + 1 });
        return;
      }
      itemResult.status = "failed";
      itemResult.error = message;
      task.progress.failed++;
      console.warn(`[EnrichQueue] 提取最终失败 ${items[itemIndex]?.link ?? ""}:`, message);
      await Promise.resolve(callbacks?.onItemDone?.(items[itemIndex], itemIndex));
    }
    this.checkTaskComplete(taskId);
  }


  /** 检查任务是否所有条目已完结（done/failed），若是则触发 onAllDone */
  private checkTaskComplete(taskId: string): void {
    const task = this.tasks.get(taskId);
    const items = this.taskItems.get(taskId);
    const callbacks = this.taskCallbacks.get(taskId);
    if (!task || !items) return;
    const allSettled = task.itemResults.every((r) => r.status === "done" || r.status === "failed");
    if (!allSettled) return;
    task.status = "done";
    task.completedAt = new Date().toISOString();
    console.log(`[EnrichQueue] 任务完成 ${taskId}（${task.sourceUrl}）：成功 ${task.progress.done} / 失败 ${task.progress.failed}`);
    Promise.resolve(callbacks?.onAllDone?.(items)).catch((err) => {
      console.warn("[EnrichQueue] onAllDone 回调异常:", err instanceof Error ? err.message : err);
    });
  }


  /** 根据 taskId 查询任务状态（不含条目正文，避免序列化过大） */
  getTask(id: string): EnrichTask | undefined {
    return this.tasks.get(id);
  }


  /** 根据 taskId 获取当前已提取的条目列表（含部分完成的条目） */
  getTaskItems(id: string): FeedItem[] | undefined {
    return this.taskItems.get(id);
  }
}


/** 全局单例：整个进程共享一个队列，统一控制并发 */
export const enrichQueue = new EnrichQueue();
