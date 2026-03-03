// Chat 路由：pi-agent + MCP 工具，SSE 流式响应

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createFeedAgent } from "../../agent/index.js";

export function registerChatRoutes(app: Hono): void {
  app.post("/api/chat/stream", async (c) => {
    try {
      const body = await c.req.json<{ prompt?: string }>();
      const prompt = body?.prompt?.trim();
      if (!prompt) return c.json({ error: "prompt 不能为空" }, 400);
      const agent = createFeedAgent();
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
            send("done", {});
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
