// 工具定义：单一来源，可转换为 AgentTool 或 MCP tool

import { Type } from "@mariozechner/pi-ai";
import { z } from "zod";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fn from "../functions.js";

/** 中性参数 schema 定义，可转为 Type 或 Zod */
type ParamDef =
  | { type: "string"; optional?: boolean; description?: string; minLength?: number }
  | { type: "number"; optional?: boolean; description?: string; default?: number; minimum?: number; maximum?: number };

function paramDefToType(_key: string, def: ParamDef): ReturnType<typeof Type.String> | ReturnType<typeof Type.Number> {
  if (def.type === "string") {
    const t = Type.String(def.description ? { description: def.description, minLength: def.minLength } : {});
    return def.optional ? Type.Optional(t) : t;
  }
  const t = Type.Number(
    def.description || def.default !== undefined || def.minimum !== undefined || def.maximum !== undefined
      ? { description: def.description, default: def.default, minimum: def.minimum, maximum: def.maximum }
      : {},
  );
  return def.optional ? Type.Optional(t) : t;
}

function paramDefToZod(def: ParamDef): z.ZodTypeAny {
  if (def.type === "string") {
    let s: z.ZodTypeAny = z.string();
    if (def.minLength) s = (s as z.ZodString).min(def.minLength);
    if (def.description) s = s.describe(def.description);
    return def.optional ? s.optional() : s;
  }
  let s: z.ZodTypeAny = z.number();
  if (def.minimum !== undefined) s = (s as z.ZodNumber).min(def.minimum);
  if (def.maximum !== undefined) s = (s as z.ZodNumber).max(def.maximum);
  if (def.description) s = s.describe(def.description);
  if (def.default !== undefined) s = (s as z.ZodNumber).optional().default(def.default);
  else if (def.optional) s = (s as z.ZodNumber).optional();
  return s;
}

function paramsToType(params: Record<string, ParamDef>) {
  const entries = Object.entries(params).map(([k, v]) => [k, paramDefToType(k, v)] as const);
  return Type.Object(Object.fromEntries(entries));
}

function paramsToZodShape(params: Record<string, ParamDef>): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, paramDefToZod(v)]),
  ) as z.ZodRawShape;
}

/** 工具定义：name、description、params、run */
interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  params: Record<string, ParamDef>;
  run: (args: TArgs) => Promise<{ content: [{ type: "text"; text: string }]; details?: unknown; isError?: boolean }>;
}

const toolDefs: ToolDef[] = [
  {
    name: "list_channels",
    label: "List channels",
    description: "List all RSS channels (id, title, description).",
    params: {},
    run: async () => {
      const list = await fn.listChannels();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }],
        details: { list },
      };
    },
  },
  {
    name: "get_channel_feeds",
    label: "Get channel feeds",
    description:
      "Get feed items for a channel or all channels, without full content. Supports channel_id, since/until date range, tags filter, author fuzzy match. Use get_feed_detail with item id for full content.",
    params: {
      channel_id: { type: "string", optional: true, description: "Channel id; omit for all channels" },
      limit: { type: "number", optional: true, default: 50, minimum: 1, maximum: 200 },
      offset: { type: "number", optional: true, default: 0, minimum: 0 },
      since: { type: "string", optional: true, description: "Only items after this date (YYYY-MM-DD or ISO 8601)" },
      until: { type: "string", optional: true, description: "Only items before this date (YYYY-MM-DD or ISO 8601)" },
      tags: { type: "string", optional: true, description: "Comma-separated tags; items matching any tag are returned" },
      author: { type: "string", optional: true, description: "Author fuzzy match (min 2 chars)" },
    },
    run: async (args) => {
      const a = args as { channel_id?: string; limit?: number; offset?: number; since?: string; until?: string; tags?: string; author?: string };
      const tagsArr = typeof a.tags === "string" ? a.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const { items, hasMore } = await fn.getChannelFeeds({
        channel_id: a.channel_id,
        limit: a.limit,
        offset: a.offset,
        since: a.since,
        until: a.until,
        tags: tagsArr,
        author: a.author,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ items, hasMore }, null, 2) }],
        details: { items, hasMore },
      };
    },
  },
  {
    name: "get_feed_detail",
    label: "Get feed detail",
    description: "Get full detail of a single feed item by id (guid), including content.",
    params: {
      item_id: { type: "string", description: "Feed item id (guid)" },
    },
    run: async (args) => {
      const a = args as { item_id: string };
      const item = await fn.getFeedDetail(a.item_id);
      if (!item) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Item not found", id: a.item_id }) },
          ],
          details: { error: "Item not found" },
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        details: item,
      };
    },
  },
  {
    name: "search_feeds",
    label: "Search feeds",
    description:
      "Search or filter feed items. Full-text query q matches title/summary/content (FTS5). Optional: channel_id (scope to channel), source_url, author (fuzzy), tags (comma-separated), since/until date range. Omit q to filter by other params only. Use get_feed_detail with item id for full content.",
    params: {
      q: { type: "string", optional: true, description: "Full-text search query; omit to filter only" },
      channel_id: { type: "string", optional: true, description: "Limit to feeds from this channel" },
      source_url: { type: "string", optional: true, description: "Filter by source URL" },
      author: { type: "string", optional: true, description: "Author fuzzy match (min 2 chars)" },
      tags: { type: "string", optional: true, description: "Comma-separated tags; match any" },
      since: { type: "string", optional: true, description: "Only items after date (YYYY-MM-DD or ISO 8601)" },
      until: { type: "string", optional: true, description: "Only items before date (YYYY-MM-DD or ISO 8601)" },
      limit: { type: "number", optional: true, default: 20, minimum: 1, maximum: 100 },
      offset: { type: "number", optional: true, default: 0, minimum: 0 },
    },
    run: async (args) => {
      const a = args as {
        q?: string;
        channel_id?: string;
        source_url?: string;
        author?: string;
        tags?: string;
        since?: string;
        until?: string;
        limit?: number;
        offset?: number;
      };
      const tagsArr = typeof a.tags === "string" ? a.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const { items, total } = await fn.searchFeeds({
        q: a.q,
        channel_id: a.channel_id,
        source_url: a.source_url,
        author: a.author,
        tags: tagsArr,
        since: a.since,
        until: a.until,
        limit: a.limit,
        offset: a.offset,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ items, total }, null, 2) }],
        details: { items, total },
      };
    },
  },
  {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web for real-time information via Brave Search. Use when user needs latest news, facts not in RSS feeds, or external sources. Returns title, url, description per result.",
    params: {
      query: { type: "string", description: "Search query" },
      count: { type: "number", optional: true, default: 8, minimum: 1, maximum: 20, description: "Max results to return" },
    },
    run: async (args) => {
      const a = args as { query: string; count?: number };
      const { results, error } = await fn.webSearch({ query: a.query, count: a.count });
      if (error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error, results: [] }, null, 2) }],
          details: { error, results: [] },
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ results }, null, 2) }],
        details: { results },
      };
    },
  },
  {
    name: "web_fetch",
    label: "Web fetch",
    description:
      "Fetch and extract main content from a URL. Uses Readability to get title, author, summary, content. Best for static pages (blogs, docs, news). JS-rendered SPAs may return incomplete content.",
    params: {
      url: { type: "string", description: "URL to fetch (with or without https://)" },
    },
    run: async (args) => {
      const a = args as { url: string };
      const result = await fn.webFetch({ url: a.url });
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: result,
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  },
];

/** 转为 AgentTool[] */
export function toAgentTools(): AgentTool[] {
  return toolDefs.map((def) => {
    const parameters = paramsToType(def.params);
    return {
      name: def.name,
      label: def.label,
      description: def.description,
      parameters,
      async execute(_, args) {
        return def.run(args as Record<string, unknown>);
      },
    } as AgentTool;
  });
}

/** 注册到 MCP server */
export function registerMcpTools(server: McpServer): void {
  for (const def of toolDefs) {
    const zodShape = paramsToZodShape(def.params);
    server.tool(def.name, def.description, zodShape, async (args) => {
      const result = await def.run(args as Record<string, unknown>);
      return {
        content: result.content,
        ...(result.isError && { isError: true }),
      };
    });
  }
}
