# Scheduler

通用调度器：cron 定时任务、分组并发、重试、一次性任务入队。

## 功能

- 定时：cron 表达式（与缓存 key、时间窗口对齐）
- 分组：限制并发，超限排队
- 重试：可配置次数与间隔
- 一次性：入队执行一次，可选返回值

## 类型

```ts
type ScheduledTask = () => Promise<void>;

interface ScheduleOptions {
  retries?: number;        // 失败重试次数，默认 0
  retryDelayMs?: number;   // 重试间隔（毫秒），默认 5000
  cron?: string;           // cron 表达式；不填=一次性任务
  concurrency?: number;    // 分组并发数，首次使用时生效，默认 10
  runNow?: boolean;        // 定时任务：注册后是否立即执行一次
}

interface GroupStats {
  running: number;         // 正在执行数
  queued: number;          // 排队数
  concurrency: number;     // 最大并发
  scheduledCount: number;  // 该组定时任务数
  completedCount: number;  // 已完成数（进程内累计）
  nextRunTime: number;     // 0=执行中，-1=无定时，其他=下一次执行时间戳
}
```

## API

| 函数 | 说明 |
|------|------|
| `schedule(group, id, task, options)` | 调度任务。`options.cron` 有值=定时任务（返回 boolean），无值=一次性任务（返回 `Promise<T>`） |
| `unschedule(id)` | 取消定时任务 |
| `unscheduleGroup(group)` | 取消分组下所有定时任务 |
| `runNow(id, priority?)` | 立即执行已注册的定时任务，`priority` 插队 |
| `validateCron(expr)` | 校验 cron |
| `getGroupStats()` | 分组统计 |
| `getTaskIds()` | 已注册任务 id |
| `clearAll()` | 清空 |

## Cron

`node-cron`，本地时区。格式：`分 时 日 月 周`，如 `0 4 * * *` 每天 4:00。
