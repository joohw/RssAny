// Feeder：根据 URL 生成 RSS，直接通过 Source 接口驱动，与具体信源解耦

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey } from "../cacher/index.js";
import { getSource } from "../sources/index.js";
import { AuthRequiredError } from "../auth/index.js";
import { buildRssXml } from "../feed/index.js";
import type { RssChannel, RssEntry } from "../feed/types.js";
import type { FeedItem } from "../types/feedItem.js";
import type { FeederConfig, FeederResult } from "./types.js";
import { upsertItems, updateItemContent } from "../db/index.js";
import { enrichQueue } from "../enrich/index.js";


const FEEDS_SUBDIR = "feeds";


/** feeds 缓存结构 */
interface FeedCache {
  items: FeedItem[];
  listUrl: string;
  channel: RssChannel;
}


/** 从 feeds 缓存读取 XML：key 本身已编码时间窗口，存在即有效，无需 mtime 检查 */
async function readFeedsCache(cacheDir: string, key: string): Promise<string | null> {
  try {
    return await readFile(join(cacheDir, FEEDS_SUBDIR, `${key}.xml`), "utf-8");
  } catch {
    return null;
  }
}


/** 从 feeds 缓存读取 items JSON，与 XML 同目录同 key，扩展名不同 */
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


/** 将 feeds XML 写入缓存 */
async function writeFeedsCache(cacheDir: string, key: string, xml: string): Promise<void> {
  const dir = join(cacheDir, FEEDS_SUBDIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.xml`), xml, "utf-8");
}


/** 将 items 写入缓存（与 XML 同目录，.items.json 后缀） */
async function writeItemsCache(cacheDir: string, key: string, items: FeedItem[]): Promise<void> {
  const dir = join(cacheDir, FEEDS_SUBDIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.items.json`), JSON.stringify(items, null, 2), "utf-8");
}


/** 根据条目生成 RssEntry：有正文用 contentHtml，否则用 summary，不显示占位文案 */
function toRssEntry(item: FeedItem): RssEntry {
  const hasContent = item.contentHtml != null && item.contentHtml !== "";
  const desc = hasContent ? (item.contentHtml ?? "") : (item.summary ?? "");
  return {
    title: item.title,
    link: item.link,
    description: desc,
    guid: item.guid,
    published: item.pubDate?.toISOString?.() ?? undefined,
  };
}


/** 从 FeedCache 构建 RSS XML */
function buildRssFromCache(cache: FeedCache): string {
  return buildRssXml(cache.channel, cache.items.map((it) => toRssEntry(it)));
}


/** 错误 RSS：URL 抓取失败（如 404）时返回 */
function buildErrorRss(listUrl: string, message: string): string {
  const channel: RssChannel = {
    title: "RSS 抓取失败",
    link: listUrl,
    description: message,
  };
  const entries: RssEntry[] = [
    { title: "抓取失败", link: listUrl, description: message, guid: "error" },
  ];
  return buildRssXml(channel, entries);
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
    const xml = buildErrorRss(listUrl, `抓取失败: ${message}`);
    return { xml, items: [] };
  }
  const channel: RssChannel = {
    title: items[0]?.author ? `${items[0].author} 的订阅` : "RSS 订阅",
    link: listUrl,
    description: `来自 ${listUrl} 的订阅`,
  };
  const cache: FeedCache = { items, listUrl, channel };
  const initialXml = buildRssFromCache(cache);
  if (cacheDir) {
    await writeFeedsCache(cacheDir, key, initialXml);
    await writeItemsCache(cacheDir, key, items);
  }
  generatingKeys.delete(key);
  if (config.writeDb) {
    upsertItems(items, listUrl).catch((err) => console.warn("[db] upsertItems 失败:", err instanceof Error ? err.message : err));
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
        items[index] = enrichedItem;
        if (config.writeDb) {
          updateItemContent(enrichedItem).catch((err) => console.warn("[db] updateItemContent 失败:", err instanceof Error ? err.message : err));
        }
        if (cacheDir) {
          const xml = buildRssFromCache(cache);
          await writeFeedsCache(cacheDir, key, xml);
          await writeItemsCache(cacheDir, key, items);
        }
      },
      onAllDone: async () => {
        if (cacheDir) {
          const xml = buildRssFromCache(cache);
          await writeFeedsCache(cacheDir, key, xml);
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
    const [cachedXml, cachedItems] = await Promise.all([
      readFeedsCache(cacheDir, key),
      readItemsCache(cacheDir, key),
    ]);
    if (cachedXml != null) {
      if (config.writeDb && cachedItems != null && cachedItems.length > 0) {
        upsertItems(cachedItems, listUrl).catch((err) => console.warn("[db] upsertItems(缓存命中) 失败:", err instanceof Error ? err.message : err));
      }
      return { xml: cachedXml, fromCache: true, items: cachedItems ?? [] };
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
