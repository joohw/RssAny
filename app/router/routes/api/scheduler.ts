// /api/scheduler/stats

import type { Hono } from "hono";
import * as scheduler from "../../../scheduler/index.js";

export function registerSchedulerRoutes(app: Hono): void {
  app.get("/api/scheduler/stats", (c) => {
    const stats = scheduler.getGroupStats();
    return c.json(stats);
  });
}
