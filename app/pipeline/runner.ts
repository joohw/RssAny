// Pipeline 执行器：按配置顺序执行处理函数

import type { FeedItem } from "../types/feedItem.js";
import type { PipelineContext } from "./types.js";
import { loadPipelineConfig } from "./config.js";
import { getPipelineStep } from "./registry.js";
import { logger } from "../core/logger/index.js";


let configCache: { enabled: boolean; steps: string[] } | null = null;


async function getConfig(): Promise<{ enabled: boolean; steps: string[] }> {
  if (configCache) return configCache;
  const cfg = await loadPipelineConfig();
  configCache = { enabled: cfg.enabled ?? false, steps: cfg.steps ?? [] };
  return configCache;
}


/**
 * 对一批条目执行 pipeline；若未启用或 steps 为空则原样返回。
 * 每个条目依次经过 steps 中的每个处理函数。
 */
export async function runPipeline(
  items: FeedItem[],
  ctx: PipelineContext,
): Promise<FeedItem[]> {
  const config = await getConfig();
  if (!config.enabled || config.steps.length === 0) {
    return items;
  }
  const result: FeedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    for (const stepName of config.steps) {
      const fn = getPipelineStep(stepName);
      if (!fn) {
        logger.warn("pipeline", "未找到步骤，跳过", { step: stepName, item_url: item.link });
        continue;
      }
      try {
        item = await fn(item, ctx);
      } catch (err) {
        logger.warn("pipeline", "步骤执行失败", {
          step: stepName,
          item_url: item.link,
          err: err instanceof Error ? err.message : String(err),
        });
        // 失败时保留原条目，不中断后续步骤
      }
    }
    result.push(item);
  }
  return result;
}


/**
 * 对单条条目执行 pipeline（用于 enrich 后的 updateItemContent 前）。
 */
export async function runPipelineOnItem(
  item: FeedItem,
  ctx: PipelineContext,
): Promise<FeedItem> {
  const [out] = await runPipeline([item], ctx);
  return out;
}


/** 清除配置缓存（用于测试或热重载） */
export function clearPipelineConfigCache(): void {
  configCache = null;
}
