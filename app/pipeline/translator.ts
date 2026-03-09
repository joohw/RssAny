/**
 * Pipeline 步骤：LLM 翻译为中文
 *
 * 将条目的 title、summary、content 翻译为中文，写入 item.translations["zh-CN"]。
 * 路由支持 lng=zh-CN 时可据此返回译文。
 *
 * 需要配置 OPENAI_API_KEY（或等效 LLM 环境变量）。
 */

import type { FeedItem } from "../types/feedItem.js";

const ZH_CN = "zh-CN";
const MAX_CONTENT_CHARS = 6000;

const SYSTEM = `你是一个专业翻译助手。将用户提供的英文（或其他语言）内容翻译为简体中文。
- 保持专业、准确、流畅。
- 若原文已是中文，则保持原样或轻微润色。
- 只输出 JSON，格式：{"title": "译文标题", "summary": "译文摘要", "content": "译文正文"}
- 若某字段为空或用户未提供，对应输出空字符串 ""。`;

export interface TranslatorContext {
  llm?: { chatJson: (prompt: string, config?: unknown, opts?: { maxTokens?: number; debugLabel?: string }) => Promise<Record<string, unknown>> };
}

/** 跳过已有 zh-CN 译文的条目；无 LLM 则跳过 */
export function translatorMatch(item: FeedItem, ctx: TranslatorContext): boolean {
  const hasZh = item.translations?.[ZH_CN];
  return !hasZh && !!ctx.llm;
}

export async function runTranslator(item: FeedItem, ctx: TranslatorContext): Promise<FeedItem> {
  if (!ctx.llm) return item;

  const title = (item.title ?? "").trim();
  const summary = (item.summary ?? item.content?.slice(0, 500) ?? "").trim();
  const content = (item.content ?? "").trim();
  const contentTruncated =
    content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) + "\n\n[... 内容已截断 ...]" : content;

  if (!title && !summary && !content) return item;

  const parts: string[] = [];
  if (title) parts.push(`标题：\n${title}`);
  if (summary) parts.push(`摘要：\n${summary}`);
  if (contentTruncated) parts.push(`正文：\n${contentTruncated}`);

  const prompt = `${SYSTEM}\n\n请翻译以下内容：\n\n${parts.join("\n\n---\n\n")}`;

  let res: Record<string, unknown>;
  try {
    res = await ctx.llm.chatJson(prompt, undefined, {
      maxTokens: Math.min(8192, Math.ceil((title.length + summary.length + contentTruncated.length) * 1.5)),
      debugLabel: "translator",
    });
  } catch {
    return item;
  }

  const tTitle = typeof res.title === "string" ? res.title.trim() : "";
  const tSummary = typeof res.summary === "string" ? res.summary.trim() : "";
  const tContent = typeof res.content === "string" ? res.content.trim() : "";

  if (!tTitle && !tSummary && !tContent) return item;

  item.translations = item.translations ?? {};
  item.translations[ZH_CN] = {
    title: tTitle || undefined,
    summary: tSummary || undefined,
    content: tContent || undefined,
  };

  return item;
}
