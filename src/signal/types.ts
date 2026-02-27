// Signal 投递配置类型（来自 .rssany/config.json 的 signal 块）

export interface SignalConfig {
  /** 是否启用投递到 Signal 仓库 */
  enabled: boolean
  /** Signal 仓库本地路径（相对 cwd 或绝对路径），如 "../AI-Signals" */
  repoPath: string
}
