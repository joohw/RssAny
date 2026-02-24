// 订阅配置类型：一个订阅由多个信源组成，支持网页、RSS、邮件、API 等多种类型

import type { RefreshInterval } from "../utils/refreshInterval.js";


/** 信源类型枚举 */
export type SourceType = "web" | "rss" | "email" | "api";


/**
 * 单个信源配置
 *
 * ref 格式示例：
 *   web / rss  →  https://sspai.com/feed
 *              →  https://xiaohongshu.com/user/profile/xxx
 *   email      →  imaps://user:password@imap.gmail.com:993/INBOX
 *              →  imap://user:password@imap.qq.com:143/INBOX
 *              →  imaps://me%40gmail.com:app-password@imap.gmail.com/INBOX
 *              （用户名含 @ 时用 %40 编码；Gmail 需使用「应用专用密码」）
 *   api        →  https://api.github.com/notifications
 */
export interface SubscriptionSource {
  /** 信源标识符：HTTP(S) URL / imaps?:// 连接串 / api:// 端点等 */
  ref: string;
  /** 信源类型（省略时由 getSource 自动识别） */
  type?: SourceType;
  /** 显示名称，用于界面展示和报错信息（省略则显示 ref） */
  label?: string;
  /** 单源有效时间窗口覆盖：优先级高于 Source 声明；不填则使用 Source 声明 */
  refresh?: RefreshInterval;
  /** 单源代理覆盖：优先级高于 Source.proxy；不填则使用 Source.proxy 或 env HTTP_PROXY */
  proxy?: string;
}


/** 单个订阅的配置 */
export interface SubscriptionConfig {
  /** 订阅标题 */
  title?: string;
  /** 订阅描述 */
  description?: string;
  /** 信源列表 */
  sources: SubscriptionSource[];
  /** 每个信源最多返回多少条目，不填则不限制 */
  maxItemsPerSource?: number;
  /** 定时拉取间隔；不填则不启用自动拉取 */
  pullInterval?: RefreshInterval;
}


/** subscriptions.json 的顶层结构：key 为订阅 id */
export type SubscriptionsMap = Record<string, SubscriptionConfig>;


/** 从旧格式（{ url }）或新格式（{ ref }）中提取信源标识符，确保向后兼容 */
export function resolveRef(src: SubscriptionSource | { url?: string; ref?: string }): string {
  return (src as SubscriptionSource).ref ?? (src as { url?: string }).url ?? "";
}
