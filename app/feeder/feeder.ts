// Feeder：根据 URL 生成 RSS，直接通过 Source 接口驱动，与具体信源解耦

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey } from "../core/cacher/index.js";
import { getSource } from "../scraper/sources/index.js";
import { getMatchedEnrichPlugin, getMatchedPipelinePlugins } from "../scraper/sources/web/pluginLoader.js";
import { buildEnrichContext } from "../scraper/sources/web/index.js";
import { AuthRequiredError } from "../scraper/auth/index.js";
import { buildRssXml } from "./rss.js";
import type { RssChannel, RssEntry } from "./types.js";
import type { FeedItem } from "../types/feedItem.js";
import { normalizeAuthor } from "../types/feedItem.js";
import { getEffectiveItemFields } from "../types/feedItem.js";
import type { FeederConfig } from "./types.js";
import type { SourceContext } from "../scraper/sources/types.js";
import { upsertItems, updateItemContent } from "../db/index.js";
import { enrichQueue } from "../scraper/enrich/index.js";
import { writeItems, writeItem } from "../writer/index.js";
import { runPipeline } from "../pipeline/index.js";
import { logger } from "../core/logger/index.js";


const FEEDS_SUBDIR = "feeds";


/** 从 feeds 缓存读取 items JSON */
async function readItemsCache(cacheDir: string, key: string): Promise<FeedItem[] | null> {
  const filePath = join(cacheDir, FEEDS_SUBDIR, `${key}.items.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return (parsed as FeedItem[]).map((item) => ({ ...item, pubDate: item.pubDate ? new Date(item.pubDate) : new Date() }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logger.debug("feeder", "feeds 缓存读取失败", { path: filePath, err: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}


/** 根据 listUrl + items 构建 RssChannel（与 generateAndCache 一致，用于缓存命中时实时生成 XML）；lng 存在时设置 channel.language */
function buildChannelFromItems(listUrl: string, items: FeedItem[], lng?: string | null): RssChannel {
  const channel: RssChannel = {
    title: items[0]?.author?.length ? `${items[0].author[0]} 的订阅` : "RSS 订阅",
    link: listUrl,
    description: `来自 ${listUrl} 的订阅`,
  };
  if (lng) channel.language = lng;
  return channel;
}


/** 将 items 写入缓存（仅存 JSON，不再存 XML） */
async function writeItemsCache(cacheDir: string, key: string, items: FeedItem[]): Promise<void> {
  const dir = join(cacheDir, FEEDS_SUBDIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.items.json`), JSON.stringify(items, null, 2), "utf-8");
}


/** 根据条目生成 RssEntry：有 lng 且存在译文则用译文，否则用原文；有正文用 content，否则用 summary */
function toRssEntry(item: FeedItem, lng?: string | null): RssEntry {
  const eff = getEffectiveItemFields(item, lng);
  const hasContent = eff.content != null && eff.content !== "";
  const desc = hasContent ? eff.content : eff.summary;
  return {
    title: eff.title,
    link: item.link,
    description: desc,
    guid: item.guid,
    published: item.pubDate?.toISOString?.() ?? undefined,
  };
}


/** 同一 URL 的首次生成任务去重（仅在初始 fetch+parse 阶段有效） */
const generatingKeys = new Map<string, Promise<{ items: FeedItem[] }>>();


/** 执行 pipeline：config 步骤 + 匹配的 pipeline 插件 */
async function runPipelineWithPlugins(
  items: FeedItem[],
  ctx: { sourceUrl: string; isEnriched?: boolean },
): Promise<FeedItem[]> {
  const result = await runPipeline(items, ctx);
  const pluginCtx = { sourceUrl: ctx.sourceUrl, isEnriched: ctx.isEnriched };
  const out: FeedItem[] = [];
  for (let i = 0; i < result.length; i++) {
    let item = result[i];
    const plugins = getMatchedPipelinePlugins(item, pluginCtx);
    for (const p of plugins) {
      try {
        item = await p.run(item, pluginCtx);
      } catch (err) {
        logger.warn("feeder", "Pipeline 插件执行失败", {
          pluginId: p.id,
          item_url: item.link,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    out.push(item);
  }
  return out;
}


/** 单条 pipeline（config + 匹配的插件） */
async function runPipelineOnItemWithPlugins(
  item: FeedItem,
  ctx: { sourceUrl: string; isEnriched?: boolean },
): Promise<FeedItem> {
  const [out] = await runPipelineWithPlugins([item], ctx);
  return out;
}


/** 构建组合 enrich 函数：source.enrichItem 优先，无则用匹配的 enrich 插件补充 */
function buildEnrichFn(
  source: { enrichItem?: (item: FeedItem, ctx: SourceContext) => Promise<FeedItem> },
  listUrl: string,
  ctx: SourceContext,
): (item: FeedItem) => Promise<FeedItem> {
  const enrichCtx = buildEnrichContext(ctx);
  enrichCtx.sourceUrl = listUrl;
  return async (item: FeedItem) => {
    let result = item;
    if (source.enrichItem) {
      result = await source.enrichItem!(item, ctx);
    }
    const plugin = getMatchedEnrichPlugin(result, { sourceUrl: listUrl });
    if (plugin) {
      result = await plugin.enrichItem(result, enrichCtx);
    }
    return result;
  };
}


/** 执行生成流程：获取条目列表；若信源有 enrichItem 或匹配 enrich 插件则提交到 EnrichQueue */
async function generateAndCache(listUrl: string, key: string, config: FeederConfig): Promise<{ items: FeedItem[] }> {
  const { cacheDir = "cache", includeContent = true, headless } = config;
  const source = getSource(listUrl);
  const ctx = { cacheDir, headless, proxy: config.proxy ?? source.proxy };
  let items: FeedItem[];
  try {
    items = await source.fetchItems(listUrl, ctx);
  } catch (err) {
    generatingKeys.delete(key);
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("feeder", "抓取失败", { source_url: listUrl, err: message });
    throw err;
  }
  items.forEach((i) => {
    i.sourceRef = listUrl;
    i.author = normalizeAuthor(i.author);
  });
  items = await runPipelineWithPlugins(items, { sourceUrl: listUrl, isEnriched: false });
  if (cacheDir) {
    await writeItemsCache(cacheDir, key, items);
    logger.debug("feeder", "feeds 缓存写入", { key, count: items.length });
  }
  generatingKeys.delete(key);
  if (config.writeDb) {
    upsertItems(items).catch((err) =>
      logger.warn("db", "upsertItems 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
    );
    writeItems(items).catch((err) =>
      logger.warn("writer", "批量写入失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
    );
  }
  const hasEnrich =
    source.enrichItem != null || items.some((i) => getMatchedEnrichPlugin(i, { sourceUrl: listUrl }));
  if (!includeContent || items.length === 0 || !hasEnrich) {
    return { items };
  }
  const enrichFn = (item: FeedItem, _ctx: SourceContext) => buildEnrichFn(source, listUrl, ctx)(item);
  await enrichQueue.submit(
    items,
    enrichFn,
    ctx,
    {
      sourceUrl: listUrl,
      onItemDone: async (enrichedItem, index) => {
        enrichedItem.sourceRef = listUrl;
        const processed = await runPipelineOnItemWithPlugins(enrichedItem, { sourceUrl: listUrl, isEnriched: true });
        items[index] = processed;
        if (config.writeDb) {
          updateItemContent(processed).catch((err) =>
            logger.warn("db", "updateItemContent 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
          );
          writeItem(processed).catch((err) =>
            logger.warn("writer", "写单条失败", { url: enrichedItem.link, err: err instanceof Error ? err.message : String(err) })
          );
        }
        if (cacheDir) {
          await writeItemsCache(cacheDir, key, items);
        }
      },
      onAllDone: async () => {
        if (cacheDir) {
          await writeItemsCache(cacheDir, key, items);
        }
      },
    },
  );
  return { items };
}


/** 根据 list URL 获取条目列表：按站点刷新策略生成时间窗口 key，命中缓存则直接返回，否则抓取并缓存 */
export async function getItems(listUrl: string, config: FeederConfig = {}): Promise<{ items: FeedItem[]; fromCache: boolean }> {
  const { cacheDir = "cache" } = config;
  const source = getSource(listUrl);
  const strategy = config.refreshInterval ?? source.refreshInterval ?? "1day";
  const key = cacheKey(listUrl, strategy);
  if (cacheDir) {
    const cachedItems = await readItemsCache(cacheDir, key);
    if (cachedItems !== null) {
      logger.debug("feeder", "feeds 缓存命中", { key, count: cachedItems.length });
      cachedItems.forEach((i) => {
        i.sourceRef ??= listUrl;
        i.author = normalizeAuthor(i.author);
      });
      if (config.writeDb && cachedItems.length > 0) {
        upsertItems(cachedItems).catch((err) =>
          logger.warn("db", "upsertItems(缓存命中) 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
        );
        writeItems(cachedItems).catch((err) =>
          logger.warn("writer", "批量写入(缓存命中) 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
        );
      }
      return { items: cachedItems, fromCache: true };
    }
  }
  if (source.preCheck != null) {
    try {
      await source.preCheck({ cacheDir, headless: config.headless, proxy: config.proxy ?? source.proxy });
    } catch (err) {
      if (err instanceof AuthRequiredError) throw err;
      throw err;
    }
  }
  let task = generatingKeys.get(key);
  if (!task) {
    task = generateAndCache(listUrl, key, config);
    generatingKeys.set(key, task);
  }
  const { items } = await task;
  return { items, fromCache: false };
}


/** 将 FeedItem[] 转为 RSS 2.0 XML 字符串 */
export function feedItemsToRssXml(items: FeedItem[], listUrl: string, lng?: string | null): string {
  const channel = buildChannelFromItems(listUrl, items, lng);
  return buildRssXml(channel, items.map((it) => toRssEntry(it, lng)));
}
