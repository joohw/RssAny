// 日志类型与结构化条目
// 设计原则：控制台由 LOG_LEVEL 过滤（默认 info），不把一切打满控制台；error/warn 可落库便于按信源排查。

/** 日志级别：控制输出与落库策略（debug < info < warn < error） */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** 日志分类：按模块筛选，便于在 DB/控制台按 category 过滤 */
export type LogCategory =
  | "feeder"   // RSS 生成与抓取
  | "scheduler" // 定时拉取与重调度
  | "enrich"   // 正文提取队列
  | "db"       // 数据库写入
  | "auth"     // 认证与登录
  | "plugin"   // 插件加载
  | "source"   // 信源解析/拉取（含 fetcher、parser、extractor）
  | "llm"      // LLM 调用
  | "app"      // HTTP 服务、启动、隧道
  | "config";  // 配置与迁移

/** payload 常用字段约定（非强制）：便于查询与统计 */
export interface LogPayloadConvention {
  /** 错误对象 message，避免序列化整个 Error */
  err?: string;
  /** 任务/队列 ID */
  taskId?: string;
  /** 条目 URL（与 source_url 区分：source_url=信源列表页） */
  item_url?: string;
  /** 重试次数等 */
  retries?: number;
  [k: string]: unknown;
}

/** 单条日志的结构化数据 */
export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  /** 可选上下文（err、taskId、item_url 等），落库时存为 JSON */
  payload?: Record<string, unknown>;
  /** 信源 URL（列表页），便于按信源查日志 */
  source_url?: string;
  created_at: string;
}

/** 写入目标：控制台 / 数据库（内部用） */
export interface LogWriter {
  write(entry: LogEntry): void;
}

/** 从环境读取的日志配置 */
export interface LogConfig {
  /** 控制台输出最低级别，低于此级别不打印 */
  consoleLevel: LogLevel;
  /** 是否将 error/warn 写入数据库 */
  logToDb: boolean;
  /** 落库的最低级别（默认 warn，即 error + warn） */
  dbLevel: LogLevel;
}
