// 内置 pipeline 步骤：翻译（写入 item.translations[lng]）

import type { FeedItem } from "../../types/feedItem.js";
import type { PipelineContext, PipelineFn } from "../types.js";


/**
 * 翻译步骤：可为空实现，或接入 LLM/翻译 API 写入 translations。
 * 目标语种可从 ctx 或 config 读取；用户可通过 .rssany/pipeline/ 覆盖。
 */
export const translateStep: PipelineFn = async (item: FeedItem, _ctx: PipelineContext): Promise<FeedItem> => {
  // 若已有目标语种译文则保留；否则可在此调用翻译服务
  // 示例：item.translations = { ...item.translations, [targetLng]: { title, summary, content } };
  return item;
};
