// Pipeline 类型定义：处理函数接口与上下文

import type { FeedItem } from "../types/feedItem.js";


/** Pipeline 上下文，供处理函数获取信源、阶段等信息 */
export interface PipelineContext {
  /** 列表页 URL（信源标识） */
  sourceUrl: string;
  /** 是否已 enrich（有 content），用于区分列表阶段与详情阶段 */
  isEnriched?: boolean;
  /** 其他扩展上下文（如 cacheDir、proxy 等） */
  [key: string]: unknown;
}


/**
 * Pipeline 处理函数：接收 FeedItem，返回处理后的 FeedItem。
 * 必须保持 FeedItem 类型兼容，可修改任意字段（如 translations、categories）。
 */
export type PipelineFn = (item: FeedItem, ctx: PipelineContext) => Promise<FeedItem>;


/** 可注册的 pipeline 步骤（含名称与执行函数） */
export interface PipelineStep {
  name: string;
  run: PipelineFn;
}


/** 来自 .rssany/config.json 的 pipeline 配置 */
export interface PipelineConfig {
  /** 是否启用 pipeline，默认 false */
  enabled?: boolean;
  /** 处理步骤名称数组，按顺序执行 */
  steps?: string[];
}
