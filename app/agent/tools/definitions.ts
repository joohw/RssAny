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

type ToolRunResult = Awaited<ReturnType<ToolDef["run"]>>;

function toolTextContent(text: string): [{ type: "text"; text: string }] {
  return [{ type: "text" as const, text }] as [{ type: "text"; text: string }];
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
    name: "search_sources",
    label: "Search sources",
    description:
      "Search or filter sources (sources.json) by keyword (ref, label, description) and/or channel_id. Returns ref, label, description, and which channel_ids each source belongs to.",
    params: {
      q: { type: "string", optional: true, description: "Keyword to match in ref, label, or description" },
      channel_id: { type: "string", optional: true, description: "Only sources that belong to this channel" },
    },
    run: async (args) => {
      const a = args as { q?: string; channel_id?: string };
      const { sources } = await fn.searchSources({ q: a.q, channel_id: a.channel_id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ sources }, null, 2) }],
        details: { sources },
      };
    },
  },
  {
    name: "get_feeds",
    label: "Get feeds",
    description:
      "Get feed items with full params: channel_id, source_url, full-text q, since/until, tags, author, limit, offset. No content in list; use get_feed_detail with item id for full content.",
    params: {
      channel_id: { type: "string", optional: true, description: "Scope to this channel; omit for all channels" },
      source_url: { type: "string", optional: true, description: "Scope to this source URL (single source)" },
      q: { type: "string", optional: true, description: "Full-text search (title/summary/content, FTS5)" },
      since: { type: "string", optional: true, description: "Only items after date (YYYY-MM-DD or ISO 8601)" },
      until: { type: "string", optional: true, description: "Only items before date (YYYY-MM-DD or ISO 8601)" },
      tags: { type: "string", optional: true, description: "Comma-separated tags; match any" },
      author: { type: "string", optional: true, description: "Author fuzzy match (min 2 chars)" },
      limit: { type: "number", optional: true, default: 50, minimum: 1, maximum: 200 },
      offset: { type: "number", optional: true, default: 0, minimum: 0 },
    },
    run: async (args) => {
      const a = args as {
        channel_id?: string;
        source_url?: string;
        q?: string;
        since?: string;
        until?: string;
        tags?: string;
        author?: string;
        limit?: number;
        offset?: number;
      };
      const tagsArr = typeof a.tags === "string" ? a.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      const { items, total } = await fn.getFeeds({
        channel_id: a.channel_id,
        source_url: a.source_url,
        q: a.q,
        since: a.since,
        until: a.until,
        tags: tagsArr,
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
    name: "web_search",
    label: "Web search",
    description:
      "Search the web for real-time information via Tavily Search. Use when user needs latest news, facts not in RSS feeds, or external sources. Returns title, url, description per result.",
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
  {
    name: "send_email",
    label: "Send email",
    description:
      "Send an email via the configured SMTP (nicefeed@163.com). Use when the user asks to send an email, forward content, or notify someone by email. Requires NICEFEED_SMTP_USER and NICEFEED_SMTP_PASSWORD in .env.",
    params: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject" },
      text: { type: "string", optional: true, description: "Plain text body" },
      html: { type: "string", optional: true, description: "HTML body (optional, use text or html)" },
      cc: { type: "string", optional: true, description: "CC addresses, comma-separated" },
      bcc: { type: "string", optional: true, description: "BCC addresses, comma-separated" },
    },
    run: async (args) => {
      const a = args as { to: string; subject: string; text?: string; html?: string; cc?: string; bcc?: string };
      const result = await fn.sendEmail({
        to: a.to,
        subject: a.subject,
        text: a.text,
        html: a.html,
        cc: a.cc,
        bcc: a.bcc,
      });
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: result.error }) }],
          details: result,
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, messageId: result.messageId }) }],
        details: result,
      };
    },
  },
  {
    name: "sandbox",
    label: "Sandbox",
    description:
      "Read, write, search-replace, or list files under .rssany/sandbox only. Use action: read (path; optional encoding, offset/limit in lines for long files), write (path, content; optional create_dirs), replace (path, old_string, new_string; unique match by default, or replace_all=1), list (optional path default '.', optional recursive=1).",
    params: {
      action: {
        type: "string",
        minLength: 1,
        description: "One of: read, write, replace, list",
      },
      path: {
        type: "string",
        optional: true,
        description: "Relative to sandbox; required for read, write, replace; for list omit or use '.' for root",
      },
      encoding: { type: "string", optional: true, description: "read: encoding (default utf-8)" },
      offset: { type: "number", optional: true, minimum: 0, description: "read: skip first N lines" },
      limit: { type: "number", optional: true, minimum: 1, maximum: 10000, description: "read: max lines to return" },
      content: { type: "string", optional: true, description: "write: full file body (may be empty string)" },
      create_dirs: {
        type: "number",
        optional: true,
        description: "write: 1 create parent dirs (default), 0 fail if parent missing",
      },
      old_string: { type: "string", optional: true, description: "replace: literal to find (non-empty)" },
      new_string: { type: "string", optional: true, description: "replace: replacement; omit for empty" },
      replace_all: {
        type: "number",
        optional: true,
        description: "replace: 1 = all occurrences; else exactly one match required",
      },
      recursive: { type: "number", optional: true, description: "list: 1 = recursive" },
    },
    run: async (args): Promise<ToolRunResult> => {
      const a = args as {
        action: string;
        path?: string;
        encoding?: string;
        offset?: number;
        limit?: number;
        content?: string;
        create_dirs?: number;
        old_string?: string;
        new_string?: string;
        replace_all?: number;
        recursive?: number;
      };
      const action = String(a.action ?? "")
        .trim()
        .toLowerCase();
      const err = (msg: string): ToolRunResult => ({
        content: toolTextContent(JSON.stringify({ error: msg })),
        details: { error: msg },
        isError: true,
      });

      if (action === "read") {
        const path = a.path?.trim();
        if (!path) return err("read 需要 path");
        const result = await fn.readFileSandbox({
          path,
          encoding: a.encoding,
          offset: a.offset,
          limit: a.limit,
        });
        if ("error" in result) {
          return {
            content: toolTextContent(JSON.stringify({ error: result.error })),
            details: result,
            isError: true,
          };
        }
        return {
          content: toolTextContent(result.content),
          details: { path: result.path, length: result.content.length },
        };
      }

      if (action === "write") {
        const path = a.path?.trim();
        if (!path) return err("write 需要 path");
        if (typeof a.content !== "string") return err("write 需要 content（字符串，可为空）");
        const result = await fn.writeFileSandbox({
          path,
          content: a.content,
          create_dirs: a.create_dirs !== 0,
        });
        if ("error" in result) {
          return {
            content: toolTextContent(JSON.stringify({ error: result.error })),
            details: result,
            isError: true,
          };
        }
        return {
          content: toolTextContent(JSON.stringify({ path: result.path })),
          details: result,
        };
      }

      if (action === "replace") {
        const path = a.path?.trim();
        if (!path) return err("replace 需要 path");
        const oldS = a.old_string;
        if (typeof oldS !== "string" || !oldS.length) return err("replace 需要非空的 old_string");
        const newS = typeof a.new_string === "string" ? a.new_string : "";
        const result = await fn.replaceInFileSandbox({
          path,
          old_string: oldS,
          new_string: newS,
          replace_all: a.replace_all,
        });
        if ("error" in result) {
          return {
            content: toolTextContent(JSON.stringify({ error: result.error })),
            details: result,
            isError: true,
          };
        }
        return {
          content: toolTextContent(JSON.stringify({ path: result.path, replaced_count: result.replaced_count })),
          details: result,
        };
      }

      if (action === "list") {
        const path = a.path?.trim() || ".";
        const result = await fn.listDirectorySandbox({
          path,
          recursive: a.recursive === 1,
        });
        if ("error" in result) {
          return {
            content: toolTextContent(JSON.stringify({ error: result.error })),
            details: result,
            isError: true,
          };
        }
        return {
          content: toolTextContent(JSON.stringify({ entries: result.entries, root: result.root }, null, 2)),
          details: result,
        };
      }

      return err(`未知 action「${a.action}」，应为 read、write、replace 或 list`);
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
