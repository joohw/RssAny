// /api/logs

import type { Hono } from "hono";
import { queryLogs } from "../../../db/index.js";
import type { LogCategory } from "../../../core/logger/types.js";

export function registerLogsRoutes(app: Hono): void {
  app.get("/api/logs", async (c) => {
    const levelParam = c.req.query("level");
    const level = levelParam === "error" || levelParam === "warn" || levelParam === "info" || levelParam === "debug" ? levelParam : undefined;
    const categoryParam = c.req.query("category");
    const category = categoryParam && /^(feeder|enrich|db|auth|plugin|source|llm|app|config|pipeline|deliver)$/.test(categoryParam) ? categoryParam : undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const sinceParam = c.req.query("since");
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const result = await queryLogs({ level, category: category as LogCategory | undefined, limit, offset, since });
    return c.json(result);
  });
}
