// /api/enrich/:taskId

import type { Hono } from "hono";
import { enrichQueue } from "../../../scraper/enrich/index.js";

export function registerEnrichRoutes(app: Hono): void {
  app.get("/api/enrich/:taskId", (c) => {
    const taskId = c.req.param("taskId");
    const task = enrichQueue.getTask(taskId);
    if (!task) return c.json({ error: "任务不存在或已过期" }, 404);
    return c.json(task);
  });
}
