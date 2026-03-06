// 纯函数实现：Agent 与 MCP 共用，包装后才是 tools

import { getAllChannelConfigs, collectAllSourceRefs } from "../core/channel/index.js";
import { queryFeedItems, getItemById, queryItems } from "../db/index.js";
import { extractHtml } from "../scraper/sources/web/extractor/index.js";

export interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  sourceRefsCount: number;
}

export interface FeedItemSummary {
  id: string;
  url: string;
  source_url: string;
  title: string | null;
  author: string[] | null;
  summary: string | null;
  pub_date: string | null;
  fetched_at: string;
}

export interface FeedItemDetail extends FeedItemSummary {
  content: string | null;
  pushed_at: string | null;
}

/** list_channels：列出所有 RSS 频道 */
export async function listChannels(): Promise<ChannelInfo[]> {
  const channels = await getAllChannelConfigs();
  return channels.map((ch) => ({
    id: ch.id,
    title: ch.title ?? ch.id,
    description: ch.description ?? "",
    sourceRefsCount: ch.sourceRefs?.length ?? 0,
  }));
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s || typeof s !== "string") return undefined;
  const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export interface GetChannelFeedsArgs {
  channel_id?: string;
  limit?: number;
  offset?: number;
  /** 仅返回此时间之后的条目，格式 YYYY-MM-DD 或 ISO 8601 */
  since?: string;
  /** 仅返回此时间之前的条目，格式 YYYY-MM-DD 或 ISO 8601 */
  until?: string;
  /** 按标签过滤，满足任一标签即返回 */
  tags?: string[];
  /** 作者模糊匹配，至少 2 字符 */
  author?: string;
}

/** get_channel_feeds：获取频道或全部 feeds 列表（不含正文） */
export async function getChannelFeeds(args: GetChannelFeedsArgs): Promise<{
  items: FeedItemSummary[];
  hasMore: boolean;
}> {
  const { channel_id, limit = 50, offset = 0, since, until, tags, author } = args;
  const channels = await getAllChannelConfigs();
  let sourceRefs: string[];
  if (channel_id && channel_id !== "all") {
    const ch = channels.find((c) => c.id === channel_id);
    sourceRefs = ch?.sourceRefs ?? [];
  } else {
    sourceRefs = collectAllSourceRefs(channels);
  }
  if (sourceRefs.length === 0) return { items: [], hasMore: false };

  if (tags?.length || author) {
    const { items, total } = await queryItems({
      sourceUrls: sourceRefs,
      tags: tags?.length ? tags : undefined,
      author: author && author.trim().length >= 2 ? author.trim() : undefined,
      limit,
      offset,
      since: parseDate(since),
      until: parseDate(until),
    });
    const noDetail = items.map((it) => ({
      id: it.id,
      url: it.url,
      source_url: it.source_url,
      title: it.title,
      author: it.author,
      summary: it.summary,
      pub_date: it.pub_date,
      fetched_at: it.fetched_at,
    }));
    return { items: noDetail, hasMore: offset + items.length < total };
  }

  const { items, hasMore } = await queryFeedItems(sourceRefs, limit, offset, { since, until });
  const noDetail = items.map((it) => ({
    id: it.id,
    url: it.url,
    source_url: it.source_url,
    title: it.title,
    author: it.author,
    summary: it.summary,
    pub_date: it.pub_date,
    fetched_at: it.fetched_at,
  }));
  return { items: noDetail, hasMore };
}

/** get_feed_detail：按 id 获取单条 feed 完整详情（含 content） */
export async function getFeedDetail(itemId: string): Promise<FeedItemDetail | null> {
  const item = await getItemById(itemId);
  if (!item) return null;
  return {
    id: item.id,
    url: item.url,
    source_url: item.source_url,
    title: item.title,
    author: item.author,
    summary: item.summary,
    content: item.content,
    pub_date: item.pub_date,
    fetched_at: item.fetched_at,
    pushed_at: item.pushed_at,
  };
}

export interface SearchFeedsArgs {
  /** 全文搜索关键词（FTS5），可选；不传则仅按过滤条件返回 */
  q?: string;
  source_url?: string;
  /** 限定在指定频道内搜索，与 source_url 互斥 */
  channel_id?: string;
  author?: string;
  /** 按标签过滤，满足任一标签即返回 */
  tags?: string[];
  limit?: number;
  offset?: number;
  /** 仅返回此时间之后的条目，YYYY-MM-DD 或 ISO 8601 */
  since?: string;
  /** 仅返回此时间之前的条目，YYYY-MM-DD 或 ISO 8601 */
  until?: string;
}

/** search_feeds：全文搜索 feeds，支持多维度过滤 */
export async function searchFeeds(args: SearchFeedsArgs): Promise<{
  items: FeedItemSummary[];
  total: number;
}> {
  const { q, source_url, channel_id, author, tags, limit = 20, offset = 0, since, until } = args;
  let sourceUrls: string[] | undefined;
  let sourceUrl: string | undefined;
  if (channel_id && channel_id !== "all") {
    const channels = await getAllChannelConfigs();
    const ch = channels.find((c) => c.id === channel_id);
    sourceUrls = ch?.sourceRefs ?? [];
  } else if (source_url) {
    sourceUrl = source_url;
  }
  const { items, total } = await queryItems({
    q: q?.trim() || undefined,
    sourceUrl,
    sourceUrls,
    author: author && author.trim().length >= 2 ? author.trim() : undefined,
    tags: tags?.length ? tags : undefined,
    limit,
    offset,
    since: parseDate(since),
    until: parseDate(until),
  });
  const list = items.map((it) => ({
    id: it.id,
    url: it.url,
    source_url: it.source_url,
    title: it.title,
    author: it.author,
    summary: it.summary,
    pub_date: it.pub_date,
    fetched_at: it.fetched_at,
  }));
  return { items: list, total };
}

export interface WebSearchArgs {
  query: string;
  count?: number;
}

/** web_search：通过 Brave Search API 搜索网页，获取实时信息（需配置 BRAVE_API_KEY） */
export async function webSearch(args: WebSearchArgs): Promise<{
  results: { title: string; url: string; description: string }[];
  error?: string;
}> {
  const apiKey = process.env.BRAVE_API_KEY?.trim();
  if (!apiKey) {
    return {
      results: [],
      error: "未配置 BRAVE_API_KEY，请在 .env 中设置。获取 API Key: https://api-dashboard.search.brave.com",
    };
  }
  const { query, count = 8 } = args;
  const q = String(query || "").trim();
  if (!q) return { results: [] };

  try {
    const params = new URLSearchParams({ q, count: String(Math.min(20, Math.max(1, count))) });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        results: [],
        error: `Brave API ${res.status}: ${errText.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const raw = data?.web?.results ?? [];
    const results = raw
      .filter((r) => r?.url)
      .map((r) => ({
        title: String(r.title ?? "").trim() || "(无标题)",
        url: String(r.url ?? ""),
        description: String(r.description ?? "").trim(),
      }));
    return { results };
  } catch (e) {
    return {
      results: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface WebFetchArgs {
  url: string;
}

/** web_fetch：抓取指定 URL 的网页正文（Readability 提取），适用于静态页面。JS 渲染的 SPA 可能提取不全。 */
export async function webFetch(args: WebFetchArgs): Promise<{
  url: string;
  title?: string;
  author?: string;
  summary?: string;
  content?: string;
  error?: string;
}> {
  const rawUrl = String(args?.url ?? "").trim();
  if (!rawUrl) return { url: rawUrl, error: "url 不能为空" };
  let url: string;
  try {
    url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    new URL(url);
  } catch {
    return { url: rawUrl, error: "无效的 URL" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return { url: res.url || url, error: `HTTP ${res.status}` };
    const html = await res.text();
    if (html.length > 2_000_000) return { url: res.url || url, error: "页面过大（>2MB），已跳过" };
    const extracted = await extractHtml(html, { url: res.url || url, mode: "readability", useCache: false });
    return {
      url: res.url || url,
      title: extracted.title,
      author: extracted.author,
      summary: extracted.summary,
      content: extracted.content?.slice(0, 50000) ?? extracted.content,
    };
  } catch (e) {
    clearTimeout(timeout);
    return {
      url,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
