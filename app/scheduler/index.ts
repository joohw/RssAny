// 通用调度器：支持定时任务（间隔/cron）、重试与分组并发

import { schedule as cronSchedule, validate as cronValidate } from "node-cron";

/** 校验 cron 表达式是否合法 */
export const validateCron = cronValidate;

/** 调度任务：返回 Promise，失败时由调度器负责重试 */
export type ScheduledTask = () => Promise<void>;


/** 调度选项 */
export interface ScheduleOptions {
  /** 失败时重试次数，默认 0 */
  retries?: number;
  /** 重试间隔（毫秒），默认 5000 */
  retryDelayMs?: number;
  /** 所属分组，用于并发控制；不填则立即执行、无并发限制 */
  group?: string;
  /** 注册后是否立即执行一次（warmup），默认 false */
  runNow?: boolean;
}


/** 分组配置 */
export interface GroupConfig {
  /** 该组最大并发数 */
  concurrency: number;
}


/** 已注册任务 */
interface RegisteredTask {
  id: string;
  /** 间隔毫秒（cron 时为 0） */
  intervalMs: number;
  task: ScheduledTask;
  options: ScheduleOptions;
  stop: () => void;
}


/** 分组队列项 */
interface QueuedItem {
  id: string;
  task: ScheduledTask | (() => Promise<unknown>);
  options: ScheduleOptions;
  resolve?: () => void;
  resolveValue?: (value: unknown) => void;
  rejectValue?: (err: unknown) => void;
}


const tasks = new Map<string, RegisteredTask>();
const groups = new Map<string, { config: GroupConfig; running: number; queue: QueuedItem[] }>();
const DEFAULT_RETRY_DELAY_MS = 5000;


async function runWithRetry(
  task: ScheduledTask,
  options: ScheduleOptions
): Promise<void> {
  const retries = options.retries ?? 0;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await task();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastErr;
}


async function runWithRetryAndResult<T>(
  task: () => Promise<T>,
  options: ScheduleOptions
): Promise<T> {
  const retries = options.retries ?? 0;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastErr;
}


function ensureGroup(group: string, concurrency: number): void {
  if (!groups.has(group)) {
    groups.set(group, { config: { concurrency }, running: 0, queue: [] });
  } else {
    groups.get(group)!.config.concurrency = concurrency;
  }
}


function enqueueAndProcess(
  group: string,
  id: string,
  task: ScheduledTask | (() => Promise<unknown>),
  options: ScheduleOptions,
  resolve?: () => void,
  priority?: boolean,
  resolveValue?: (value: unknown) => void,
  rejectValue?: (err: unknown) => void
): void {
  const g = groups.get(group);
  if (!g) return;
  const item: QueuedItem = { id, task, options, resolve, resolveValue, rejectValue };
  if (priority) {
    g.queue.unshift(item);
  } else {
    g.queue.push(item);
  }
  processGroupQueue(group);
}


function processGroupQueue(group: string): void {
  const g = groups.get(group);
  if (!g || g.running >= g.config.concurrency || g.queue.length === 0) return;
  const item = g.queue.shift()!;
  g.running += 1;
  const done = () => {
    g.running -= 1;
    processGroupQueue(group);
  };
  if (item.resolveValue != null || item.rejectValue != null) {
    runWithRetryAndResult(item.task as () => Promise<unknown>, item.options)
      .then((result) => {
        item.resolveValue?.(result);
      })
      .catch((err) => {
        item.rejectValue?.(err);
      })
      .finally(done);
  } else {
    runWithRetry(item.task as ScheduledTask, item.options)
      .catch(() => {})
      .finally(() => {
        item.resolve?.();
        done();
      });
  }
}


/**
 * 注册分组并设置并发数
 * @param group 分组名
 * @param concurrency 该组最大并发数
 */
export function registerGroup(group: string, concurrency: number): void {
  ensureGroup(group, concurrency);
}


/**
 * 注册定时任务
 * @param id 任务唯一标识
 * @param intervalOrCron 刷新间隔（毫秒）或 cron 表达式（如 "0 9 * * *" 每天 9:00）
 * @param task 异步任务函数
 * @param options 可选：retries、retryDelayMs、group、runNow
 * @returns 是否注册成功
 */
export function schedule(
  id: string,
  intervalOrCron: number | string,
  task: ScheduledTask,
  options: ScheduleOptions = {}
): boolean {
  unschedule(id);

  const group = options.group;
  if (group) ensureGroup(group, groups.get(group)?.config.concurrency ?? 5);

  const runTask = () => {
    if (group) {
      enqueueAndProcess(group, id, task, options);
    } else {
      runWithRetry(task, options).catch(() => {});
    }
  };

  let stop: () => void;
  let intervalMs: number;

  if (typeof intervalOrCron === "string") {
    if (!cronValidate(intervalOrCron)) return false;
    const job = cronSchedule(intervalOrCron, runTask);
    stop = () => job.stop();
    intervalMs = 0;
  } else {
    if (!intervalOrCron || intervalOrCron <= 0) return false;
    const timer = setInterval(runTask, intervalOrCron);
    stop = () => clearInterval(timer);
    intervalMs = intervalOrCron;
  }

  tasks.set(id, {
    id,
    intervalMs,
    task,
    options,
    stop,
  });

  if (options.runNow) {
    runNow(id, true).catch(() => {});
  }
  return true;
}


/**
 * 取消任务
 */
export function unschedule(id: string): void {
  const reg = tasks.get(id);
  if (reg) {
    reg.stop();
    tasks.delete(id);
  }
}


/**
 * 取消指定分组下的所有定时任务（不清理队列，用于 reschedule 前仅移除本组任务）
 */
export function unscheduleGroup(group: string): void {
  const ids = [...tasks.entries()].filter(([, reg]) => reg.options.group === group).map(([id]) => id);
  for (const id of ids) unschedule(id);
}


/**
 * 立即执行一次任务（不等待下次定时）
 * @param id 任务 id
 * @param priority 有分组时，true 表示插入队首优先执行，默认 false 插入队尾
 */
export function runNow(id: string, priority = false): Promise<void> {
  const reg = tasks.get(id);
  if (!reg) return Promise.resolve();
  const group = reg.options.group;
  if (group) {
    return new Promise<void>((resolve) => {
      enqueueAndProcess(group, id, reg.task, reg.options, resolve, priority);
    });
  }
  return runWithRetry(reg.task, reg.options);
}


/**
 * 立即执行一次任务（不等待下次定时）
 * 适用于未注册的临时任务，直接执行
 */
export async function runWithRetryOnce(
  _id: string,
  task: ScheduledTask,
  options: ScheduleOptions = {}
): Promise<void> {
  await runWithRetry(task, options);
}


/**
 * 清空所有任务（含各分组队列中的待执行项）
 */
export function clearAll(): void {
  for (const [, reg] of tasks) {
    reg.stop();
  }
  tasks.clear();
  for (const g of groups.values()) {
    g.queue.length = 0;
  }
}


/**
 * 批量执行任务（用于 warmUp），限制并发
 * @param ids 要执行的任务 id 列表，空则执行全部
 * @param concurrency 并发数，默认 5
 */
export async function warmUp(ids: string[] = [], concurrency = 5): Promise<void> {
  const toRun = ids.length > 0 ? ids.filter((id) => tasks.has(id)) : [...tasks.keys()];
  const runBatch = async (start: number): Promise<void> => {
    if (start >= toRun.length) return;
    const batch = toRun.slice(start, start + concurrency);
    await Promise.all(batch.map((id) => runNow(id).catch(() => {})));
    await runBatch(start + batch.length);
  };
  await runBatch(0);
}


/**
 * 获取已注册任务 id 列表
 */
export function getTaskIds(): string[] {
  return [...tasks.keys()];
}


/** 分组统计 */
export interface GroupStats {
  /** 正在执行的任务数 */
  running: number;
  /** 队列中等待的任务数 */
  queued: number;
  /** 该组最大并发数 */
  concurrency: number;
  /** 该组下已注册的定时任务数量 */
  scheduledCount: number;
}


/**
 * 获取各分组的执行统计，用于管理页进度条等
 */
export function getGroupStats(): Record<string, GroupStats> {
  const result: Record<string, GroupStats> = {};
  for (const [name, g] of groups) {
    const scheduledCount = [...tasks.values()].filter((t) => t.options.group === name).length;
    result[name] = {
      running: g.running,
      queued: g.queue.length,
      concurrency: g.config.concurrency,
      scheduledCount,
    };
  }
  return result;
}


/**
 * 将一次性任务入组执行（不注册定时，仅执行一次）
 * 用于 enrich 等非周期任务，复用分组并发与重试
 * @param group 分组名，需已 registerGroup
 * @param id 任务唯一 id（用于去重，同 id 可覆盖队内未执行的）
 * @param task 任务函数
 * @param options 可选 retries、retryDelayMs
 * @returns Promise，任务完成时 resolve
 */
export function enqueueOneOff(
  group: string,
  id: string,
  task: ScheduledTask,
  options: ScheduleOptions = {}
): Promise<void> {
  ensureGroup(group, groups.get(group)?.config.concurrency ?? 2);
  return new Promise<void>((resolve) => {
    enqueueAndProcess(group, id, task, options, resolve, false);
  });
}


/**
 * 将一次性任务入组执行并返回结果（用于 HTTP 路由等需要获取返回值的场景）
 */
export function enqueueWithResult<T>(
  group: string,
  id: string,
  task: () => Promise<T>,
  options: ScheduleOptions = {}
): Promise<T> {
  ensureGroup(group, groups.get(group)?.config.concurrency ?? 2);
  return new Promise<T>((resolve, reject) => {
    enqueueAndProcess(group, id, task, options, undefined, true, resolve as (v: unknown) => void, reject);
  });
}
