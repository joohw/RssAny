// MCP 服务：基于 Streamable HTTP（SSE），提供 list_channels / get_channel_feeds / get_feed_detail 工具
// 使用 stateless 模式：每个请求新建 transport+server，避免 Cursor 等多客户端/重试时触发 "Server already initialized"

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../core/channel/index.js";
import { queryFeedItems, getItemById, queryItems } from "../db/index.js";

let cachedHandler: ((request: Request) => Promise<Response>) | null = null;

function registerTools(server: McpServer): void {
  server.tool(
    "list_channels",
    "List all RSS channels (id, title, description).",
    async () => {
      const channels = await getAllChannelConfigs();
      const list = channels.map((ch) => ({
        id: ch.id,
        title: ch.title ?? ch.id,
        description: ch.description ?? "",
        sourceRefsCount: ch.sourceRefs?.length ?? 0,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    "get_channel_feeds",
    "Get feed items for a channel or all channels, without full content. Optional channel_id, limit, offset.",
    {
      channel_id: z.string().optional().describe("Channel id; omit for all channels"),
      limit: z.number().min(1).max(200).optional().default(50),
      offset: z.number().min(0).optional().default(0),
    },
    async (args) => {
      const channels = await getAllChannelConfigs();
      let sourceRefs: string[];
      if (args.channel_id && args.channel_id !== "all") {
        const ch = channels.find((c) => c.id === args.channel_id);
        sourceRefs = ch?.sourceRefs ?? [];
      } else {
        sourceRefs = collectAllSourceRefs(channels);
      }
      const { items, hasMore } = await queryFeedItems(
        sourceRefs,
        args.limit ?? 50,
        args.offset ?? 0,
      );
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
        content: [
          { type: "text" as const, text: JSON.stringify({ items: noDetail, hasMore }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "get_feed_detail",
    "Get full detail of a single feed item by id (guid), including content.",
    { item_id: z.string().describe("Feed item id (guid)") },
    async (args) => {
      const item = await getItemById(args.item_id);
      if (!item) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Item not found", id: args.item_id }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
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
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "search_feeds",
    "Search feed items by full-text query (matches title, summary, content). Returns item list without full content; use get_feed_detail with item id for full content. Optional: source_url to filter by source, limit and offset for pagination.",
    {
      q: z.string().min(1).describe("Search query (FTS5 full-text match)"),
      source_url: z.string().optional().describe("Filter by source URL; omit to search all"),
      limit: z.number().min(1).max(100).optional().default(20),
      offset: z.number().min(0).optional().default(0),
    },
    async (args) => {
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
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ items: list, total }, null, 2),
          },
        ],
      };
    },
  );
}

/**
 * 创建 MCP Streamable HTTP 处理器，供 Hono 挂到 GET/POST /mcp。
 * 使用 stateless 模式：每个请求新建 transport+server，避免多连接/重试时 "Server already initialized"。
 * 客户端通过 GET 建立 SSE、POST 发送 JSON-RPC。
 */
export async function createMcpHandler(): Promise<
  (request: Request) => Promise<Response>
> {
  if (cachedHandler) return cachedHandler;

  const handler = async (request: Request): Promise<Response> => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless：每个请求独立，可重复 initialize
    });
    const server = new McpServer(
      { name: "rssany", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server);
    await server.connect(transport);
    return transport.handleRequest(request);
  };

  cachedHandler = handler;
  return handler;
}
