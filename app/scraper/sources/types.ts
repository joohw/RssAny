// Source 抽象接口：所有信源类型的统一契约，输出 FeedItem[]

import type { FeedItem } from "../../types/feedItem.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";


/** Source 调用上下文 */
export interface SourceContext {
  /** 缓存目录 */
  cacheDir?: string;
  /** 是否使用无头浏览器，false 时显示浏览器窗口 */
  headless?: boolean;
  /** 代理地址，调用方传入，覆盖 Source.proxy；优先级最高 */
  proxy?: string;
}


/** 统一信源接口：不论是网页、RSS Feed、邮件还是 API，均实现此接口产出 FeedItem[] */
export interface Source {
  /** 信源唯一标识，如 "xiaohongshu"、"__rss__"、"email-inbox" */
  readonly id: string;
  /** 匹配 sourceId 的模式（URL、email://、api:// 等协议均可） */
  readonly pattern: string | RegExp;
  /** 条目有效时间窗口：声明该信源产出的 FeedItem 生命周期，作用于缓存键、DB 查询和调度间隔 */
  readonly refreshInterval?: RefreshInterval;
  /** 代理地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；未设置则使用 env HTTP_PROXY */
  readonly proxy?: string;
  /** 可选：fetchItems 前的预检（如认证验证），失败时抛 AuthRequiredError */
  preCheck?(ctx: SourceContext): Promise<void>;
  /** 核心契约：给定 sourceId，产出条目列表 */
  fetchItems(sourceId: string, ctx: SourceContext): Promise<FeedItem[]>;
  /** 可选：对单条目异步补全正文（WebSource 实现，Email/ApiSource 不需要） */
  enrichItem?(item: FeedItem, ctx: SourceContext): Promise<FeedItem>;
}
