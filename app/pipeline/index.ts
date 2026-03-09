/**
 * Pipeline：入库前固定处理链（翻译、打标签等）
 *
 * 与 plugins 同级别，作为固定流程而非插件系统。
 * 步骤开关与排序由 .rssany/config.json 的 pipeline.steps 配置。
 */

import type { FeedItem } from "../types/feedItem.js";
import { taggerMatch, runTagger } from "./tagger.js";
import { translatorMatch, runTranslator } from "./translator.js";
import { loadPipelineConfig } from "./config.js";
import { logger } from "../core/logger/index.js";

export interface PipelineContext {
  sourceUrl?: string;
  isEnriched?: boolean;
  llm?: {
    chatJson: (prompt: string, config?: unknown, opts?: { maxTokens?: number; debugLabel?: string }) => Promise<Record<string, unknown>>;
    chatText: (prompt: string, config?: unknown, opts?: { maxTokens?: number; debugLabel?: string }) => Promise<string>;
  };
  db?: { getSystemTags: () => Promise<string[]> };
}

/** Pipeline 步骤注册表 */
const STEP_REGISTRY: Record<string, { match: (item: FeedItem, ctx: PipelineContext) => boolean; run: (item: FeedItem, ctx: PipelineContext) => Promise<FeedItem> }> = {
  tagger: { match: taggerMatch, run: runTagger },
  translator: { match: translatorMatch, run: runTranslator },
};

/** 根据配置解析出要执行的步骤（按配置顺序，仅启用且存在的） */
async function getResolvedSteps(): Promise<Array<{ id: string; match: (item: FeedItem, ctx: PipelineContext) => boolean; run: (item: FeedItem, ctx: PipelineContext) => Promise<FeedItem> }>> {
  const config = await loadPipelineConfig();
  const out: Array<{ id: string; match: (item: FeedItem, ctx: PipelineContext) => boolean; run: (item: FeedItem, ctx: PipelineContext) => Promise<FeedItem> }> = [];
  for (const { id, enabled } of config.steps) {
    if (!enabled) continue;
    const step = STEP_REGISTRY[id];
    if (!step) {
      logger.debug("pipeline", "未知步骤已跳过", { id });
      continue;
    }
    out.push({ id, ...step });
  }
  return out;
}

/**
 * 对单条条目执行 pipeline
 */
export async function runPipeline(
  item: FeedItem,
  ctx: PipelineContext
): Promise<FeedItem> {
  const steps = await getResolvedSteps();
  let current = item;
  for (const step of steps) {
    if (!step.match(current, ctx)) continue;
    try {
      current = await step.run(current, ctx);
    } catch (err) {
      logger.warn("pipeline", "步骤执行失败", {
        stepId: step.id,
        item_url: item.link,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return current;
}

/**
 * 对多条条目执行 pipeline
 */
export async function runPipelineBatch(
  items: FeedItem[],
  ctx: PipelineContext
): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(await runPipeline(items[i], ctx));
  }
  return out;
}
