// 网关路由：接收外部爬虫推送的 FeedItem，入库后经 pipeline（打标签、翻译等）处理

import type { Hono } from "hono";
import { ingestFromGateway } from "../../feeder/index.js";

export function registerGatewayRoutes(app: Hono): void {
  app.post("/api/gateway/items", async (c) => {
    try {
      const body = await c.req.json<{ items?: unknown[]; sourceRef?: string; writeDb?: boolean }>();
      const rawItems = Array.isArray(body?.items) ? body.items : [];
      const sourceRef = typeof body?.sourceRef === "string" && body.sourceRef.trim() ? body.sourceRef.trim() : "gateway";
      const writeDb = body?.writeDb !== false;
      const result = await ingestFromGateway(rawItems, { sourceRef, writeDb });
      return c.json(result);
    } catch (err) {
      return c.json(
        { ok: false, count: 0, newCount: 0, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });
}
