// Feeder：根据 URL 生成 RSS，支持自生成（list→detail）与转发（TODO）

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey } from "../cacher/index.js";
import { fetchHtml } from "../fetcher/index.js";
import { parseHtml } from "../parser/index.js";
import { extractItem } from "../extractor/index.js";
import { preCheckAuth } from "../fetcher/index.js";
import { getSite, toAuthFlow, getProxy, getRefreshStrategy } from "../sites/index.js";
import { AuthRequiredError, NotFoundError } from "../auth/index.js";
import { buildRssXml } from "../feed/index.js";
import type { RssChannel, RssEntry } from "../feed/types.js";
import type { FeedItem } from "../types/feedItem.js";
import type { FeederConfig, FeederResult } from "./types.js";
import { upsertItems, updateItemContent } from "../db/index.js";


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
const generatingKeys = new Map<string, Promise<{ xml: string; items: FeedItem[] }>>();


/** 执行生成流程：抓取列表并写入初始缓存后立即返回；若有 includeContent 则以纯后台队列提取详情并异步覆盖缓存 */
async function generateAndCache(listUrl: string, key: string, config: FeederConfig): Promise<{ xml: string; items: FeedItem[] }> {
  const { cacheDir = "cache", includeContent = true, headless } = config;
  const site = getSite(listUrl)!;
  const proxy = getProxy(listUrl);
  const listRes = await fetchHtml(listUrl, { cacheDir, useCache: false, authFlow: toAuthFlow(site), headless, proxy, browserContext: site.browserContext ?? undefined });
  if (listRes.status !== 200) {
    generatingKeys.delete(key);
    const xml = buildErrorRss(listUrl, `抓取失败: HTTP ${listRes.status}`);
    return { xml, items: [] };
  }
  const parsed = await parseHtml(listRes.body, {
    url: listRes.finalUrl ?? listUrl,
    customParser: site.parser ?? undefined,
    cacheDir,
    useCache: false,
    cacheKey: cacheKey(listRes.finalUrl ?? listUrl, "forever"),
    includeContent: false,
  });
  const items: FeedItem[] = parsed.items;
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
  upsertItems(items, listUrl).catch((err) => console.warn("[db] upsertItems 失败:", err instanceof Error ? err.message : err));
  if (includeContent && items.length > 0 && site.extractor != null) {
    const extractorConfig = { cacheDir, useCache: false, customExtractor: site.extractor };
    const fetchConfig = { cacheDir, headless, proxy: getProxy(listUrl), browserContext: site.browserContext ?? undefined };
    (async () => {
      for (let i = 0; i < items.length; i++) {
        try {
          items[i] = await extractItem(items[i], extractorConfig, fetchConfig);
          updateItemContent(items[i]).catch((err) => console.warn("[db] updateItemContent 失败:", err instanceof Error ? err.message : err));
        } catch (err) {
          console.warn(`[feeder] 提取失败 ${items[i].link}:`, err instanceof Error ? err.message : err);
          items[i] = { ...items[i], extractionFailed: true };
        }
      }
      const finalXml = buildRssFromCache({ ...cache, items });
      if (cacheDir) {
        await writeFeedsCache(cacheDir, key, finalXml);
        await writeItemsCache(cacheDir, key, items);
      }
    })().catch((err) => console.warn("[feeder] 后台提取详情失败:", err instanceof Error ? err.message : err));
  }
  return { xml: initialXml, items };
}


/** 根据 list URL 生成 RSS：按站点刷新策略生成时间窗口 key，命中缓存则直接返回，否则抓取并缓存 */
export async function getRss(listUrl: string, config: FeederConfig = {}): Promise<FeederResult> {
  const { cacheDir = "cache" } = config;
  const site = getSite(listUrl);
  if (!site) throw new NotFoundError(`无匹配的站点: ${listUrl}`);
  const strategy = getRefreshStrategy(listUrl);
  const key = cacheKey(listUrl, strategy);
  if (cacheDir) {
    const [cachedXml, cachedItems] = await Promise.all([
      readFeedsCache(cacheDir, key),
      readItemsCache(cacheDir, key),
    ]);
    if (cachedXml != null) return { xml: cachedXml, fromCache: true, items: cachedItems ?? [] };
  }
  const authFlow = toAuthFlow(site);
  if (authFlow && cacheDir) {
    const passed = await preCheckAuth(authFlow, cacheDir);
    if (!passed) throw new AuthRequiredError(`站点 ${site.id} 需要登录，请先执行 ensureAuth`);
  }
  let task = generatingKeys.get(key);
  if (!task) {
    task = generateAndCache(listUrl, key, config);
    generatingKeys.set(key, task);
  }
  const { xml, items } = await task;
  return { xml, fromCache: false, items };
}


/** 根据 list URL 获取条目列表（getRss 的轻量包装，仅返回 items） */
export async function getItems(listUrl: string, config: FeederConfig = {}): Promise<FeedItem[]> {
  return (await getRss(listUrl, config)).items;
}
