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
      "Get feed items for a channel or all channels, without full content. Optional channel_id, limit, offset.",
    params: {
      channel_id: { type: "string", optional: true, description: "Channel id; omit for all channels" },
      limit: { type: "number", optional: true, default: 50, minimum: 1, maximum: 200 },
      offset: { type: "number", optional: true, default: 0, minimum: 0 },
    },
    run: async (args) => {
      const a = args as { channel_id?: string; limit?: number; offset?: number };
      const { items, hasMore } = await fn.getChannelFeeds({
        channel_id: a.channel_id,
        limit: a.limit,
        offset: a.offset,
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
      "Search feed items by full-text query (matches title, summary, content). Optional: source_url, author (fuzzy), limit, offset. Use get_feed_detail with item id for full content.",
    params: {
      q: { type: "string", description: "Search query (FTS5 full-text match)", minLength: 1 },
      source_url: { type: "string", optional: true, description: "Filter by source URL; omit to search all" },
      author: { type: "string", optional: true, description: "Filter by author (fuzzy match, min 2 chars)" },
      limit: { type: "number", optional: true, default: 20, minimum: 1, maximum: 100 },
      offset: { type: "number", optional: true, default: 0, minimum: 0 },
    },
    run: async (args) => {
      const a = args as { q: string; source_url?: string; author?: string; limit?: number; offset?: number };
      const { items, total } = await fn.searchFeeds({
        q: a.q,
        source_url: a.source_url,
        author: a.author,
        limit: a.limit,
        offset: a.offset,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ items, total }, null, 2) }],
        details: { items, total },
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
