// /api/admin/verify

import type { Hono } from "hono";

export function registerAdminApiRoutes(app: Hono): void {
  app.get("/api/admin/verify", async (c) => {
    return c.json({ ok: true });
  });
}
