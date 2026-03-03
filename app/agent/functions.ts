// 纯函数实现：Agent 与 MCP 共用，包装后才是 tools

import { getAllChannelConfigs, collectAllSourceRefs } from "../core/channel/index.js";
import { queryFeedItems, getItemById, queryItems } from "../db/index.js";

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

export interface GetChannelFeedsArgs {
  channel_id?: string;
  limit?: number;
  offset?: number;
}

/** get_channel_feeds：获取频道或全部 feeds 列表（不含正文） */
export async function getChannelFeeds(args: GetChannelFeedsArgs): Promise<{
  items: FeedItemSummary[];
  hasMore: boolean;
}> {
  const { channel_id, limit = 50, offset = 0 } = args;
  const channels = await getAllChannelConfigs();
  let sourceRefs: string[];
  if (channel_id && channel_id !== "all") {
    const ch = channels.find((c) => c.id === channel_id);
    sourceRefs = ch?.sourceRefs ?? [];
  } else {
    sourceRefs = collectAllSourceRefs(channels);
  }
  const { items, hasMore } = await queryFeedItems(sourceRefs, limit, offset);
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
  q: string;
  source_url?: string;
  author?: string;
  limit?: number;
  offset?: number;
}

/** search_feeds：全文搜索 feeds，支持 author 模糊匹配 */
export async function searchFeeds(args: SearchFeedsArgs): Promise<{
  items: FeedItemSummary[];
  total: number;
}> {
  const { q, source_url, author, limit = 20, offset = 0 } = args;
  const { items, total } = await queryItems({
    q,
    sourceUrl: source_url,
    author,
    limit,
    offset,
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
