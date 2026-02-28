// 写文件模块配置类型（来自 .rssany/config.json 的 writer 块）

export interface WriterConfig {
  /** 是否启用将条目写入本地目录 */
  enabled: boolean;
  /** 写文件目标目录（相对 cwd 或绝对路径），如 "../AI-Signals" */
  repoPath: string;
}
