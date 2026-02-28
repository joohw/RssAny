// Feeder：根据 URL 生成 RSS，直接通过 Source 接口驱动，与具体信源解耦

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey } from "../core/cacher/index.js";
import { getSource } from "../scraper/sources/index.js";
import { AuthRequiredError } from "../scraper/auth/index.js";
import { buildRssXml } from "./rss.js";
import type { RssChannel, RssEntry } from "./types.js";
import type { FeedItem } from "../types/feedItem.js";
import { getEffectiveItemFields } from "../types/feedItem.js";
import type { FeederConfig, FeederResult } from "./types.js";
import { upsertItems, updateItemContent } from "../db/index.js";
import { enrichQueue } from "../scraper/enrich/index.js";
import { writeItems, writeItem } from "../writer/index.js";
import { logger } from "../core/logger/index.js";


const FEEDS_SUBDIR = "feeds";


/** feeds 缓存结构 */
interface FeedCache {
  items: FeedItem[];
  listUrl: string;
  channel: RssChannel;
}


/** 从 feeds 缓存读取 items JSON（唯一缓存，命中后据此实时生成 XML） */
async function readItemsCache(cacheDir: string, key: string): Promise<FeedItem[] | null> {
  try {
    const raw = await readFile(join(cacheDir, FEEDS_SUBDIR, `${key}.items.json`), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return (parsed as FeedItem[]).map((item) => ({ ...item, pubDate: item.pubDate ? new Date(item.pubDate) : new Date() }));
  } catch {
    return null;
  }
}


/** 根据 listUrl + items 构建 RssChannel（与 generateAndCache 一致，用于缓存命中时实时生成 XML）；lng 存在时设置 channel.language */
function buildChannelFromItems(listUrl: string, items: FeedItem[], lng?: string | null): RssChannel {
  const channel: RssChannel = {
    title: items[0]?.author ? `${items[0].author} 的订阅` : "RSS 订阅",
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


/** 从 FeedCache 构建 RSS XML；lng 存在时条目与 channel 使用译文/语种 */
function buildRssFromCache(cache: FeedCache, lng?: string | null): string {
  const channel = lng ? { ...cache.channel, language: lng } : cache.channel;
  return buildRssXml(channel, cache.items.map((it) => toRssEntry(it, lng)));
}


/** 同一 URL 的首次生成任务去重（仅在初始 fetch+parse 阶段有效） */
const generatingKeys = new Map<string, Promise<{ xml: string; items: FeedItem[]; enrichTaskId?: string }>>();


/** 执行生成流程：获取条目列表后立即返回初始 XML；若信源有 enrichItem 则提交到全局 EnrichQueue 后台补全 */
async function generateAndCache(listUrl: string, key: string, config: FeederConfig): Promise<{ xml: string; items: FeedItem[]; enrichTaskId?: string }> {
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
  items.forEach((i) => { i.sourceRef = listUrl; });
  const channel: RssChannel = buildChannelFromItems(listUrl, items, config.lng);
  const cache: FeedCache = { items, listUrl, channel };
  const initialXml = buildRssFromCache(cache, config.lng);
  if (cacheDir) {
    await writeItemsCache(cacheDir, key, items);
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
  if (!includeContent || items.length === 0 || source.enrichItem == null) {
    return { xml: initialXml, items };
  }
  const enrichTaskId = await enrichQueue.submit(
    items,
    source.enrichItem.bind(source),
    ctx,
    {
      sourceUrl: listUrl,
      onItemDone: async (enrichedItem, index) => {
        enrichedItem.sourceRef = listUrl;
        items[index] = enrichedItem;
        if (config.writeDb) {
          updateItemContent(enrichedItem).catch((err) =>
            logger.warn("db", "updateItemContent 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
          );
          writeItem(enrichedItem).catch((err) =>
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
  return { xml: initialXml, items, enrichTaskId };
}


/** 根据 list URL 生成 RSS：按站点刷新策略生成时间窗口 key，命中缓存则直接返回，否则抓取并缓存 */
export async function getRss(listUrl: string, config: FeederConfig = {}): Promise<FeederResult> {
  const { cacheDir = "cache" } = config;
  const source = getSource(listUrl);
  const strategy = config.refreshInterval ?? source.refreshInterval ?? "1day";
  const key = cacheKey(listUrl, strategy);
  if (cacheDir) {
    const cachedItems = await readItemsCache(cacheDir, key);
    if (cachedItems !== null) {
      cachedItems.forEach((i) => { i.sourceRef ??= listUrl; });
      if (config.writeDb && cachedItems.length > 0) {
        upsertItems(cachedItems).catch((err) =>
          logger.warn("db", "upsertItems(缓存命中) 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
        );
        writeItems(cachedItems).catch((err) =>
          logger.warn("writer", "批量写入(缓存命中) 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
        );
      }
      const channel = buildChannelFromItems(listUrl, cachedItems, config.lng);
      const xml = buildRssXml(channel, cachedItems.map((it) => toRssEntry(it, config.lng)));
      return { xml, fromCache: true, items: cachedItems };
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
  const { xml, items, enrichTaskId } = await task;
  return { xml, fromCache: false, items, enrichTaskId };
}


/** 根据 list URL 获取条目列表（getRss 的轻量包装，仅返回 items） */
export async function getItems(listUrl: string, config: FeederConfig = {}): Promise<FeedItem[]> {
  return (await getRss(listUrl, config)).items;
}
