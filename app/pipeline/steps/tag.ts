// 内置 pipeline 步骤：打标签（基于 title/summary/content 的 LLM 或规则）

import type { FeedItem } from "../../types/feedItem.js";
import type { PipelineContext, PipelineFn } from "../types.js";


/**
 * 标签步骤：可为空实现，或接入 LLM/规则引擎生成 categories。
 * 用户可通过 .rssany/pipeline/ 下的自定义步骤覆盖。
 */
export const tagStep: PipelineFn = async (item: FeedItem, _ctx: PipelineContext): Promise<FeedItem> => {
  // 若已有 categories 则保留；否则可在此调用 LLM 或规则生成
  // 示例：item.categories = item.categories ?? await inferTags(item);
  return item;
};
