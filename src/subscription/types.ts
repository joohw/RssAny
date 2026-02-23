// 订阅配置类型：一个订阅由多个信源组成，服务于数据库/程序消费而非 RSS 阅读器

import type { RefreshInterval } from "../sites/siteConfig.js";


/** 单个信源配置 */
export interface SubscriptionSource {
  /** 列表页 URL，对应 /rss/{url} 的 url 参数 */
  url: string;
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
