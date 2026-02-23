// 正文提取器：从详情页 HTML 提取单条正文（规则 / Readability），支持缓存

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { cacheKey as cacherCacheKey } from "../cacher/index.js";
import { fetchHtml } from "../fetcher/index.js";
import type { RequestConfig } from "../fetcher/types.js";
import type { FeedItem } from "../types/feedItem.js";
import type { ExtractedResult, ExtractorConfig } from "./types.js";


const EXTRACTED_SUBDIR = "extracted";


/** 从缓存读取已提取结果 */
async function readCachedExtracted(cacheDir: string, key: string): Promise<ExtractedResult | null> {
  const filePath = join(cacheDir, EXTRACTED_SUBDIR, `${key}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ExtractedResult & { cachedAt?: string };
    return {
      author: parsed.author,
      title: parsed.title,
      summary: parsed.summary,
      content: parsed.content ?? (parsed as { contentMarkdown?: string }).contentMarkdown ?? (parsed as { contentHtml?: string }).contentHtml,
      pubDate: parsed.pubDate,
    };
  } catch {
    return null;
  }
}


/** 将提取结果写入缓存 */
async function writeCachedExtracted(cacheDir: string, key: string, result: ExtractedResult): Promise<void> {
  const dir = join(cacheDir, EXTRACTED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  const cache = { ...result, cachedAt: new Date().toISOString() };
  await writeFile(filePath, JSON.stringify(cache, null, 2), "utf-8");
}


/** 解析 key：与 fetched 一致，使用 sha256(url) */
function extractedCacheKey(url: string, config: ExtractorConfig): string {
  if (config.cacheKey != null && config.cacheKey !== "") return config.cacheKey;
  if (url) return cacherCacheKey(url, "forever");
  return "";
}


/** 使用 Readability 从详情页 HTML 提取正文 */
function extractWithReadability(html: string, url: string): ExtractedResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article) return {};
  const summary = article.excerpt && article.excerpt.length > 200 ? article.excerpt.slice(0, 200) + "…" : article.excerpt;
  return {
    author: article.byline || undefined,
    title: article.title || undefined,
    summary: summary || undefined,
    content: article.content || undefined,
  };
}


/** 从 HTML 提取正文（规则 / Readability），支持缓存 */
export async function extractHtml(html: string, config: ExtractorConfig = {}): Promise<ExtractedResult> {
  const { url = "", mode, customExtractor, cacheDir, useCache = true } = config;
  const key = extractedCacheKey(url, config);
  if (useCache !== false && cacheDir != null && cacheDir !== "" && key) {
    const cached = await readCachedExtracted(cacheDir, key);
    if (cached != null) return cached;
  }
  if (customExtractor != null) {
    const result = await Promise.resolve(customExtractor(html, url));
    if (cacheDir != null && cacheDir !== "" && key) {
      await writeCachedExtracted(cacheDir, key, result);
    }
    return result;
  }
  if (mode === "readability") {
    const result = extractWithReadability(html, url);
    if (cacheDir != null && cacheDir !== "" && key) {
      await writeCachedExtracted(cacheDir, key, result);
    }
    return result;
  }
  return {};
}


/** 根据 link 拉取 HTML 并提取正文（提取过程不缓存 fetch） */
export async function extractFromLink(
  link: string,
  extractorConfig: ExtractorConfig = {},
  fetchConfig: RequestConfig = {}
): Promise<ExtractedResult> {
  const { cacheDir } = extractorConfig;
  const fetchOpts: RequestConfig = {
    cacheDir: fetchConfig.cacheDir ?? cacheDir,
    useCache: false,
    timeoutMs: fetchConfig.timeoutMs ?? 15_000,
    ...fetchConfig,
  };
  const res = await fetchHtml(link, fetchOpts);
  if (res.status !== 200) {
    throw new Error(`fetch 失败: ${res.status} ${res.statusText} for ${link}`);
  }
  const finalUrl = res.finalUrl ?? link;
  return extractHtml(res.body, {
    ...extractorConfig,
    url: finalUrl,
    cacheKey: extractorConfig.cacheKey ?? (cacheDir ? cacherCacheKey(link, "forever") : undefined),
  });
}


/** 对单个 FeedItem 根据 link 拉取并提取正文，合并回 item（补充 author/title/summary/contentHtml/pubDate） */
export async function extractItem(
  item: FeedItem,
  extractorConfig: ExtractorConfig = {},
  fetchConfig: RequestConfig = {}
): Promise<FeedItem> {
  const extracted = await extractFromLink(item.link, extractorConfig, fetchConfig);
  const pubDate =
    extracted.pubDate != null
      ? typeof extracted.pubDate === "string"
        ? new Date(extracted.pubDate)
        : extracted.pubDate
      : item.pubDate;
  return {
    ...item,
    author: extracted.author ?? item.author,
    title: extracted.title ?? item.title,
    summary: extracted.summary ?? item.summary,
    contentHtml: extracted.content ?? item.contentHtml,
    pubDate,
  };
}


/** 对多个 FeedItem 依次提取正文并合并（可复用 fetcher 缓存） */
export async function extractItems(
  items: FeedItem[],
  extractorConfig: ExtractorConfig = {},
  fetchConfig: RequestConfig = {}
): Promise<FeedItem[]> {
  const results: FeedItem[] = [];
  const onProgress = extractorConfig.onProgress;
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await extractItem(items[i], extractorConfig, fetchConfig));
    } catch (err) {
      console.warn(`[extractor] 提取失败 ${items[i].link}:`, err instanceof Error ? err.message : String(err));
      results.push(items[i]);
    }
    onProgress?.(i + 1, items.length);
  }
  return results;
}
