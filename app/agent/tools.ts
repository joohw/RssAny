// Agent 工具：复用 MCP 工具定义（list_channels / get_channel_feeds / get_feed_detail / search_feeds）

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getAllChannelConfigs, collectAllSourceRefs } from "../core/channel/index.js";
import { queryFeedItems, getItemById, queryItems } from "../db/index.js";

/** list_channels：列出所有 RSS 频道 */
const listChannelsTool: AgentTool = {
  name: "list_channels",
  label: "List channels",
  description: "List all RSS channels (id, title, description).",
  parameters: Type.Object({}),
  async execute() {
    const channels = await getAllChannelConfigs();
    const list = channels.map((ch) => ({
      id: ch.id,
      title: ch.title ?? ch.id,
      description: ch.description ?? "",
      sourceRefsCount: ch.sourceRefs?.length ?? 0,
    }));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }],
      details: { list },
    };
  },
};

const GetChannelFeedsSchema = Type.Object({
  channel_id: Type.Optional(Type.String({ description: "Channel id; omit for all channels" })),
  limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Number({ default: 0, minimum: 0 })),
});

/** get_channel_feeds：获取频道或全部 feeds 列表（不含正文） */
const getChannelFeedsTool: AgentTool<typeof GetChannelFeedsSchema> = {
  name: "get_channel_feeds",
  label: "Get channel feeds",
  description:
    "Get feed items for a channel or all channels, without full content. Optional channel_id, limit, offset.",
  parameters: GetChannelFeedsSchema,
  async execute(_, args) {
    const channelId = args.channel_id;
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const channels = await getAllChannelConfigs();
    let sourceRefs: string[];
    if (channelId && channelId !== "all") {
      const ch = channels.find((c) => c.id === channelId);
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ items: noDetail, hasMore }, null, 2) }],
      details: { items: noDetail, hasMore },
    };
  },
};

const GetFeedDetailSchema = Type.Object({
  item_id: Type.String({ description: "Feed item id (guid)" }),
});

/** get_feed_detail：按 id 获取单条 feed 完整详情（含 content） */
const getFeedDetailTool: AgentTool<typeof GetFeedDetailSchema> = {
  name: "get_feed_detail",
  label: "Get feed detail",
  description: "Get full detail of a single feed item by id (guid), including content.",
  parameters: GetFeedDetailSchema,
  async execute(_, args) {
    const item = await getItemById(args.item_id);
    if (!item) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Item not found", id: args.item_id }),
          },
        ],
        details: { error: "Item not found" },
      };
    }
    const data = {
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      details: data,
    };
  },
};

const SearchFeedsSchema = Type.Object({
  q: Type.String({ minLength: 1, description: "Search query (FTS5 full-text match)" }),
  source_url: Type.Optional(Type.String({ description: "Filter by source URL; omit to search all" })),
  limit: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Number({ default: 0, minimum: 0 })),
});

/** search_feeds：全文搜索 feeds */
const searchFeedsTool: AgentTool<typeof SearchFeedsSchema> = {
  name: "search_feeds",
  label: "Search feeds",
  description:
    "Search feed items by full-text query (matches title, summary, content). Returns item list without full content; use get_feed_detail with item id for full content. Optional: source_url to filter by source, limit and offset for pagination.",
  parameters: SearchFeedsSchema,
  async execute(_, args) {
    const { items, total } = await queryItems({
      q: args.q,
      sourceUrl: args.source_url,
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ items: list, total }, null, 2) }],
      details: { items: list, total },
    };
  },
};

/** 所有 feed 相关 Agent 工具（与 MCP 工具定义一致） */
export const feedAgentTools = [
  listChannelsTool,
  getChannelFeedsTool,
  getFeedDetailTool,
  searchFeedsTool,
] as AgentTool[];
