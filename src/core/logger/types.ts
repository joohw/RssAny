// 日志类型与结构化条目
// 设计原则：logger 仅落库不打印控制台；全体级别落库，由日志页/API 查看。

/** 日志级别：debug < info < warn < error */
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
  | "config"   // 配置与迁移
  | "writer";  // 写文件模块（条目落盘到配置目录）

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

/** 写入目标：数据库（控制台不输出，仅启动信息用 console） */
export interface LogWriter {
  write(entry: LogEntry): void;
}

/** 从环境读取的日志配置（落库开关；控制台相关已废弃） */
export interface LogConfig {
  /** 是否将日志写入数据库（全体级别） */
  logToDb: boolean;
  /** @deprecated 控制台已不输出 */
  consoleLevel?: LogLevel;
  /** @deprecated 现为全体级别落库 */
  dbLevel?: LogLevel;
}
