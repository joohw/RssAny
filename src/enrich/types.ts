// Enrich 任务类型定义

import type { FeedItem } from "../types/feedItem.js";
import type { SourceContext } from "../sources/types.js";


/** 单条目提取状态 */
export type EnrichItemStatus = "pending" | "running" | "done" | "failed";


/** 整批任务状态 */
export type EnrichTaskStatus = "pending" | "running" | "done";


/** 单条目提取结果 */
export interface EnrichItemResult {
  index: number;
  status: EnrichItemStatus;
  /** 提取成功后填入，failed/pending 时为 undefined */
  item?: FeedItem;
  error?: string;
  retries: number;
}


/** 整批提取任务 */
export interface EnrichTask {
  id: string;
  sourceUrl: string;
  status: EnrichTaskStatus;
  progress: {
    total: number;
    done: number;
    failed: number;
  };
  itemResults: EnrichItemResult[];
  createdAt: string;
  completedAt?: string;
}


/** 来自 .rssany/config.json 的 enrich 配置 */
export interface EnrichConfig {
  /** 全局并发上限，同时进行的详情页提取数量，默认 2 */
  concurrency: number;
  /** 单条目失败重试次数（不含首次），默认 2 */
  maxRetries: number;
}


/** enrichFn 类型：与 Source.enrichItem 签名一致 */
export type EnrichFn = (item: FeedItem, ctx: SourceContext) => Promise<FeedItem>;


/** 提交任务时的回调与元信息 */
export interface EnrichSubmitOptions {
  sourceUrl: string;
  /** 单条目完成后回调（无论成功失败均调用，失败时 item 为原条目） */
  onItemDone?: (item: FeedItem, index: number) => void | Promise<void>;
  /** 所有条目全部结束后回调（含失败条目） */
  onAllDone?: (items: FeedItem[]) => void | Promise<void>;
}
