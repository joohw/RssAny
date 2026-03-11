// 通用调度器：cron 定时任务、重试与分组并发

import { CronExpressionParser } from "cron-parser";
import { schedule as cronSchedule, validate as cronValidate } from "node-cron";

/** 校验 cron 表达式是否合法 */
export const validateCron = cronValidate;

/** 调度任务：返回 Promise，失败时由调度器负责重试 */
export type ScheduledTask = () => Promise<void>;


/** 调度选项 */
export interface ScheduleOptions {
  /** cron 表达式；不填或空表示一次性任务 */
  cron?: string;
  /** 失败时重试次数，默认 0 */
  retries?: number;
  /** 重试间隔（毫秒），默认 5000 */
  retryDelayMs?: number;
  /** 分组并发数，首次使用该分组时生效，默认 10 */
  concurrency?: number;
  /** 定时任务：注册后是否立即执行一次，默认 false */
  runNow?: boolean;
  /** 一次性任务：是否插队到队首，默认 false */
  priority?: boolean;
  /** 分组名（内部使用，由 schedule 注入） */
  group?: string;
}


/** 分组配置 */
export interface GroupConfig {
  /** 该组最大并发数 */
  concurrency: number;
}


/** 已注册任务 */
interface RegisteredTask {
  id: string;
  cronExpr: string;
  task: ScheduledTask;
  options: ScheduleOptions;
  stop: () => void;
  /** 上次触发时间（用于计算下次执行） */
  lastRunTime: number;
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
const groups = new Map<string, { config: GroupConfig; running: number; queue: QueuedItem[]; completedCount: number }>();
const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_GROUP_CONCURRENCY = 10;


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
    groups.set(group, { config: { concurrency }, running: 0, queue: [], completedCount: 0 });
  } else {
    const g = groups.get(group)!;
    g.config.concurrency = concurrency;
    if (g.completedCount === undefined) g.completedCount = 0;
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
  g.queue = g.queue.filter((it) => it.id !== id);
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
    g.completedCount = (g.completedCount ?? 0) + 1;
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
 * 调度任务：options.cron 有值时注册定时任务，否则一次性入队
 * @param group 分组名
 * @param id 任务唯一标识
 * @param task 异步任务函数
 * @param options cron 有值=定时任务，无值=一次性任务；可选 retries、retryDelayMs、concurrency、runNow、priority
 */
export function schedule(group: string, id: string, task: ScheduledTask, options: ScheduleOptions & { cron: string }): boolean;
export function schedule<T>(group: string, id: string, task: () => Promise<T>, options?: ScheduleOptions): Promise<T>;
export function schedule<T>(
  group: string,
  id: string,
  task: ScheduledTask | (() => Promise<T>),
  options: ScheduleOptions = {}
): boolean | Promise<T> {
  const cronExpr = options.cron?.trim();
  ensureGroup(group, options.concurrency ?? groups.get(group)?.config.concurrency ?? DEFAULT_GROUP_CONCURRENCY);

  if (cronExpr && cronValidate(cronExpr)) {
    unschedule(id);
    const optsWithGroup = { ...options, group };
    const job = cronSchedule(cronExpr, () => {
      const reg = tasks.get(id);
      if (reg) reg.lastRunTime = Date.now();
      enqueueAndProcess(group, id, task as ScheduledTask, optsWithGroup);
    });
    tasks.set(id, {
      id,
      cronExpr,
      task: task as ScheduledTask,
      options: optsWithGroup,
      stop: () => job.stop(),
      lastRunTime: 0,
    });
    if (options.runNow) {
      runNow(id, true).catch(() => {});
    }
    return true;
  }

  return new Promise<T>((resolve, reject) => {
    enqueueAndProcess(
      group,
      id,
      task as () => Promise<unknown>,
      { ...options, group },
      undefined,
      options.priority ?? false,
      resolve as (v: unknown) => void,
      reject
    );
  });
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
  reg.lastRunTime = Date.now();
  const group = reg.options.group;
  if (group) {
    return new Promise<void>((resolve) => {
      enqueueAndProcess(group, id, reg.task, reg.options, resolve, priority);
    });
  }
  return runWithRetry(reg.task, reg.options);
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
  /** 已完成任务数（含定时任务每次执行 + 单次任务，进程启动后累计） */
  completedCount: number;
  /**
   * 下次任务时间（毫秒时间戳）
   * - 0：正在执行
   * - -1：无定时任务
   * - 其他：下次预计执行时间戳
   */
  nextRunTime: number;
}


function getNextRunForTask(reg: RegisteredTask): number {
  try {
    const base = reg.lastRunTime > 0 ? new Date(reg.lastRunTime) : new Date();
    const expr = CronExpressionParser.parse(reg.cronExpr, { currentDate: base });
    let next = expr.next().getTime();
    if (next <= Date.now()) {
      const retry = CronExpressionParser.parse(reg.cronExpr, { currentDate: new Date() });
      next = retry.next().getTime();
    }
    return next;
  } catch {
    return -1;
  }
}


/**
 * 获取各分组的执行统计，用于管理页进度条等
 */
export function getGroupStats(): Record<string, GroupStats> {
  const result: Record<string, GroupStats> = {};
  for (const [name, g] of groups) {
    const groupTasks = [...tasks.values()].filter((t) => t.options.group === name);
    const scheduledCount = groupTasks.length;
    let nextRunTime: number;
    if (g.running > 0) {
      nextRunTime = 0;
    } else if (scheduledCount === 0) {
      nextRunTime = -1;
    } else {
      const times = groupTasks.map(getNextRunForTask).filter((t) => t > 0);
      nextRunTime = times.length > 0 ? Math.min(...times) : -1;
    }
    result[name] = {
      running: g.running,
      queued: g.queue.length,
      concurrency: g.config.concurrency,
      scheduledCount,
      completedCount: g.completedCount ?? 0,
      nextRunTime,
    };
  }
  return result;
}


