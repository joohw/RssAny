// Chat 路由：pi-agent + MCP 工具，SSE 流式响应，支持对话历史

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createFeedAgent } from "../../agent/index.js";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  usage?: UsageShape;
};

type UsageShape = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

function aggregateUsage(messages: Array<{ role: string; usage?: UsageShape }>): UsageShape | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let costInput = 0;
  let costOutput = 0;
  let costCacheRead = 0;
  let costCacheWrite = 0;
  let hasAny = false;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.usage) continue;
    const u = m.usage;
    input += u.input ?? 0;
    output += u.output ?? 0;
    cacheRead += u.cacheRead ?? 0;
    cacheWrite += u.cacheWrite ?? 0;
    totalTokens += u.totalTokens ?? 0;
    if (u.cost) {
      costInput += u.cost.input ?? 0;
      costOutput += u.cost.output ?? 0;
      costCacheRead += u.cost.cacheRead ?? 0;
      costCacheWrite += u.cost.cacheWrite ?? 0;
    }
    hasAny = true;
  }
  if (!hasAny) return null;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costInput + costOutput + costCacheRead + costCacheWrite,
    },
  };
}

function toAgentMessages(messages: HistoryMessage[]): Array<{ role: string; content: unknown; timestamp: number; usage?: UsageShape }> {
  const now = Date.now();
  const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  return messages.map((m) => {
    if (m.role === "user") {
      return { role: "user" as const, content: m.content, timestamp: now };
    }
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: m.content }],
      api: "openai-completions" as const,
      provider: "openai" as const,
      model: "gpt-4o-mini",
      usage: m.usage ?? emptyUsage,
      stopReason: "stop" as const,
      timestamp: now,
    };
  });
}

export function registerChatRoutes(app: Hono): void {
  app.post("/api/chat/stream", async (c) => {
    try {
      const body = await c.req.json<{ prompt?: string; messages?: HistoryMessage[] }>();
      const prompt = body?.prompt?.trim();
      if (!prompt) return c.json({ error: "prompt 不能为空" }, 400);
      const agent = createFeedAgent();
      const history = Array.isArray(body?.messages) ? body.messages : [];
      if (history.length > 0) {
        agent.replaceMessages(toAgentMessages(history) as Parameters<typeof agent.replaceMessages>[0]);
      }
      return streamSSE(c, async (stream) => {
        const send = (event: string, data: unknown) => {
          stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
        };
        await send("start", {});
        agent.subscribe((e) => {
          if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
            send("text_delta", { delta: e.assistantMessageEvent.delta });
          } else if (e.type === "tool_execution_start") {
            send("tool_start", { toolCallId: e.toolCallId, toolName: e.toolName, args: e.args });
          } else if (e.type === "tool_execution_end") {
            send("tool_end", { toolCallId: e.toolCallId, toolName: e.toolName, isError: e.isError });
          } else if (e.type === "agent_end") {
            const usage = aggregateUsage(e.messages);
            send("done", usage ? { usage } : {});
          }
        });
        try {
          await agent.prompt(prompt);
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : String(err) });
        } finally {
          stream.close();
        }
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
