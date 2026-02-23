// Feeder：根据 URL 生成 RSS，支持自生成（list→detail）与转发（TODO）

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { cacheKey } from "../cacher/index.js";
import { fetchHtml } from "../fetcher/index.js";
import { parseHtml } from "../parser/index.js";
import { extractItem } from "../extractor/index.js";
import { preCheckAuth } from "../fetcher/index.js";
import { getSite, toAuthFlow } from "../sites/index.js";
import { AuthRequiredError, NotFoundError } from "../auth/index.js";
import { buildRssXml } from "../feed/index.js";
import type { RssChannel, RssEntry } from "../feed/types.js";
import type { FeedItem } from "../types/feedItem.js";
import type { FeederConfig, FeederResult } from "./types.js";


const FEEDS_SUBDIR = "feeds";


/** feeds 缓存结构：支持按条目展示抓取进度 */
interface FeedCache {
  items: FeedItem[];
  startedAt: number;
  listUrl: string;
  channel: RssChannel;
}


/** 从 feeds 缓存读取 XML，maxAgeMs 时用文件 mtime 判断是否过期 */
async function readFeedsCache(cacheDir: string, key: string, maxAgeMs?: number): Promise<string | null> {
  const xmlPath = join(cacheDir, FEEDS_SUBDIR, `${key}.xml`);
  try {
    const [xml, st] = await Promise.all([readFile(xmlPath, "utf-8"), stat(xmlPath)]);
    if (maxAgeMs != null && Date.now() - st.mtimeMs > maxAgeMs) return null;
    return xml;
  } catch {
    return null;
  }
}


/** 将 feeds 缓存写入（仅 XML） */
async function writeFeedsCache(cacheDir: string, key: string, xml: string): Promise<void> {
  const dir = join(cacheDir, FEEDS_SUBDIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.xml`), xml, "utf-8");
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


/** 同一 URL 的生成任务去重 */
const generatingKeys = new Map<string, Promise<string>>();
/** 生成中的状态，供刷新时展示已抓取/待抓取 */
const generatingState = new Map<string, FeedCache>();


/** 执行生成流程：先抓取列表并立即返回，若有 includeContent 则后台抓取详情并更新缓存。fetch/parse/extract 仅写缓存（供分析），不读缓存，避免错误传播；仅 feed 级缓存用于复用 */
async function generateAndCache(listUrl: string, key: string, config: FeederConfig): Promise<string> {
  const { cacheDir = "cache", includeContent = true, headless } = config;
  const site = getSite(listUrl)!;
  const listRes = await fetchHtml(listUrl, { cacheDir, useCache: false, authFlow: toAuthFlow(site), headless, proxy: site.proxy ?? undefined });
  if (listRes.status !== 200) return buildErrorRss(listUrl, `抓取失败: HTTP ${listRes.status}`);
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
  const cache: FeedCache = { items, startedAt: Date.now(), listUrl, channel };
  generatingState.set(key, cache);
  if (cacheDir) await writeFeedsCache(cacheDir, key, buildRssFromCache(cache));
  if (includeContent && items.length > 0 && site.extractor != null) {
    const extractorConfig = { cacheDir, useCache: false, customExtractor: site.extractor };
    const fetchConfig = { cacheDir, headless, proxy: site.proxy ?? undefined };
    (async () => {
      for (let i = 0; i < items.length; i++) {
        try {
          items[i] = await extractItem(items[i], extractorConfig, fetchConfig);
        } catch (err) {
          console.warn(`[feeder] 提取失败 ${items[i].link}:`, err instanceof Error ? err.message : err);
          items[i] = { ...items[i], extractionFailed: true };
        }
        generatingState.set(key, { ...cache, items: [...items] });
      }
      if (cacheDir) await writeFeedsCache(cacheDir, key, buildRssFromCache({ ...cache, items }));
      generatingState.delete(key);
    })().catch((err) => console.warn("[feeder] 后台抓取详情失败:", err instanceof Error ? err.message : err)).finally(() => generatingKeys.delete(key));
  } else {
    generatingKeys.delete(key);
    generatingState.delete(key);
  }
  return buildRssFromCache(cache);
}


/** 根据 list URL 生成 RSS：检查缓存 → 未命中则抓取列表后立即返回，详情在后台补全 */
export async function getRss(listUrl: string, config: FeederConfig = {}): Promise<FeederResult> {
  const { cacheDir = "cache", feedCacheMaxAgeMs = 60 * 60 * 1000, includeContent: _includeContent = true } = config;
  const key = createHash("sha256").update(listUrl).digest("hex");
  if (cacheDir) {
    const inProgress = generatingState.get(key);
    if (inProgress != null) return { xml: buildRssFromCache(inProgress), fromCache: false };
    const cached = await readFeedsCache(cacheDir, key, feedCacheMaxAgeMs);
    if (cached != null) return { xml: cached, fromCache: true };
  }
  const site = getSite(listUrl);
  if (!site) throw new NotFoundError(`无匹配的站点: ${listUrl}`);
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
  const xml = await task;
  return { xml, fromCache: false };
}
