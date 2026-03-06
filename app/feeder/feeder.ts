// Feeder：根据 URL 生成 RSS，直接通过 Source 接口驱动，与具体信源解耦

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey } from "../core/cacher/index.js";
import { getSource } from "../scraper/sources/index.js";
import { getMatchedEnrichPlugin, getMatchedPipelinePlugins } from "../plugins/loader.js";
import { buildEnrichContext } from "../scraper/sources/web/index.js";
import { AuthRequiredError } from "../scraper/auth/index.js";
import { buildRssXml } from "./rss.js";
import type { RssChannel, RssEntry } from "./types.js";
import type { FeedItem } from "../types/feedItem.js";
import { normalizeAuthor } from "../types/feedItem.js";
import { getEffectiveItemFields } from "../types/feedItem.js";
import type { FeederConfig } from "./types.js";
import type { SourceContext } from "../scraper/sources/types.js";
import { upsertItems, updateItemContent, getExistingIds, getSystemTags } from "../db/index.js";
import { emitFeedUpdated } from "../core/events/index.js";
import { enrichQueue } from "../scraper/enrich/index.js";
import { chatJson, chatText } from "../agent/llm.js";
import { writeItems, writeItem } from "../writer/index.js";
import type { PluginContext } from "../plugins/loader.js";
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
const llm = { chatJson, chatText };
const db = { getSystemTags };


async function runPipelineWithPlugins(
  items: FeedItem[],
  ctx: { sourceUrl: string; isEnriched?: boolean },
): Promise<FeedItem[]> {
  const pluginCtx: PluginContext = { ...ctx, llm, db };
  const out: FeedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
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


/** 单条 pipeline */
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
  if (cacheDir) {
    await writeItemsCache(cacheDir, key, items);
    logger.debug("feeder", "feeds 缓存写入", { key, count: items.length });
  }
  generatingKeys.delete(key);
  let newCount = 0;
  let newIds = new Set<string>();
  if (config.writeDb) {
    const result = await upsertItems(items).catch((err) => {
      logger.warn("db", "upsertItems 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) });
      return { newCount: 0, newIds: new Set<string>() };
    });
    newCount = result.newCount;
    newIds = result.newIds;
    writeItems(items).catch((err) =>
      logger.warn("writer", "批量写入失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
    );
  }
  const hasEnrich =
    source.enrichItem != null || items.some((i) => getMatchedEnrichPlugin(i, { sourceUrl: listUrl }));
  if (!includeContent || items.length === 0 || !hasEnrich) {
    // 无 enrich 时，pipeline 在入库后对新条目执行一次
    for (let i = 0; i < items.length; i++) {
      if (!newIds.has(items[i].guid)) continue;
      const processed = await runPipelineOnItemWithPlugins(items[i], { sourceUrl: listUrl, isEnriched: false });
      items[i] = processed;
      if (config.writeDb) {
        updateItemContent(processed).catch((err) =>
          logger.warn("db", "updateItemContent 失败", { source_url: listUrl, err: err instanceof Error ? err.message : String(err) })
        );
        writeItem(processed).catch((err) =>
          logger.warn("writer", "写单条失败", { url: processed.link, err: err instanceof Error ? err.message : String(err) })
        );
      }
    }
    if (config.writeDb && newCount > 0) {
      emitFeedUpdated({ sourceUrl: listUrl, newCount });
    }
    if (cacheDir) {
      await writeItemsCache(cacheDir, key, items);
    }
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
        // 只对新条目执行 pipeline，已存在于 DB 的条目跳过
        const processed = newIds.has(enrichedItem.guid)
          ? await runPipelineOnItemWithPlugins(enrichedItem, { sourceUrl: listUrl, isEnriched: true })
          : enrichedItem;
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
        if (config.writeDb && newCount > 0) {
          emitFeedUpdated({ sourceUrl: listUrl, newCount });
        }
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


/** 将 FeedItem[] 转为 RSS 2.0 XML 字符串；可选 channelTitle/channelDesc 覆盖默认 */
export function feedItemsToRssXml(
  items: FeedItem[],
  listUrl: string,
  lng?: string | null,
  opts?: { channelTitle?: string; channelDesc?: string }
): string {
  const channel = buildChannelFromItems(listUrl, items, lng);
  if (opts?.channelTitle) channel.title = opts.channelTitle;
  if (opts?.channelDesc) channel.description = opts.channelDesc;
  return buildRssXml(channel, items.map((it) => toRssEntry(it, lng)));
}


/** Gateway 入库配置 */
export interface GatewayIngestConfig {
  /** 信源标识，每条 item 的 sourceRef 会设为此值（若 item 已有则保留） */
  sourceRef: string;
  /** 是否写入数据库，默认 true */
  writeDb?: boolean;
}


/** 从 JSON 解析为 FeedItem（兼容 pubDate 为 ISO 字符串） */
function parseGatewayItem(raw: Record<string, unknown>): FeedItem | null {
  const link = typeof raw.link === "string" ? raw.link : null;
  if (!link) return null;
  const guid = typeof raw.guid === "string" ? raw.guid : createHash("sha256").update(link).digest("hex");
  const title = typeof raw.title === "string" ? raw.title : "";
  const pubDateRaw = raw.pubDate ?? raw.published;
  const pubDate =
    pubDateRaw instanceof Date
      ? pubDateRaw
      : typeof pubDateRaw === "string"
        ? new Date(pubDateRaw)
        : new Date();
  return {
    guid,
    title,
    link,
    pubDate: Number.isNaN(pubDate.getTime()) ? new Date() : pubDate,
    author: normalizeAuthor((raw.author as string | string[] | undefined) ?? undefined),
    summary: typeof raw.summary === "string" ? raw.summary : typeof raw.description === "string" ? raw.description : undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : undefined,
    tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()) : undefined,
    sourceRef: typeof raw.sourceRef === "string" ? raw.sourceRef : undefined,
    translations: raw.translations && typeof raw.translations === "object" ? (raw.translations as FeedItem["translations"]) : undefined,
    extra: raw.extra && typeof raw.extra === "object" ? (raw.extra as Record<string, unknown>) : undefined,
  };
}


/** 从外部 Gateway 接收 FeedItem 并入库：直接 upsertItems → updateItemContent（有 content 时）→ writeItems。不执行 pipeline，由 scraper 抓取路径负责 pipeline。 */
export async function ingestFromGateway(
  rawItems: unknown[],
  config: GatewayIngestConfig,
): Promise<{ ok: boolean; count: number; newCount: number; errors?: string[] }> {
  const { sourceRef, writeDb = true } = config;
  const items: FeedItem[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== "object") {
      errors.push(`[${i}] 非对象，已跳过`);
      continue;
    }
    const item = parseGatewayItem(raw as Record<string, unknown>);
    if (!item) {
      errors.push(`[${i}] 缺少 link，已跳过`);
      continue;
    }
    item.sourceRef = item.sourceRef ?? sourceRef;
    item.author = normalizeAuthor(item.author);
    items.push(item);
  }
  if (items.length === 0) {
    return { ok: true, count: 0, newCount: 0, errors: errors.length > 0 ? errors : undefined };
  }
  const existingIds = await getExistingIds(items.map((i) => i.guid));
  const newItems = items.filter((i) => !existingIds.has(i.guid));
  if (newItems.length === 0) {
    return { ok: true, count: 0, newCount: 0, errors: errors.length > 0 ? errors : undefined };
  }
  let newCount = 0;
  if (writeDb) {
    const result = await upsertItems(newItems, sourceRef);
    newCount = result.newCount;
    for (const item of newItems) {
      if (item.content) {
        await updateItemContent(item).catch((err) =>
          logger.warn("db", "Gateway updateItemContent 失败", { url: item.link, err: err instanceof Error ? err.message : String(err) })
        );
      }
      writeItem(item).catch((err) =>
        logger.warn("writer", "Gateway 写单条失败", { url: item.link, err: err instanceof Error ? err.message : String(err) })
      );
    }
    if (newCount > 0) {
      emitFeedUpdated({ sourceUrl: sourceRef, newCount });
    }
  }
  return { ok: true, count: newItems.length, newCount, errors: errors.length > 0 ? errors : undefined };
}
