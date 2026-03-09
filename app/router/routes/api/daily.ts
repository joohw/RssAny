// /api/daily、/api/daily/dates、/api/daily/:date、/api/daily/generate

import type { Hono } from "hono";
import { CACHE_DIR } from "../../../config/paths.js";
import { todayDate } from "../../../daily/index.js";
import { readDigest, generateDigest } from "../../../topics/index.js";

export function registerDailyRoutes(app: Hono): void {
  app.get("/api/daily/dates", async (c) => {
    const { listDigestDates } = await import("../../../topics/index.js");
    const dates = await listDigestDates(CACHE_DIR, "daily");
    return c.json({ dates });
  });

  app.get("/api/daily/:date", async (c) => {
    const date = (c.req.param("date") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date 格式应为 YYYY-MM-DD" }, 400);
    }
    const content = await readDigest(CACHE_DIR, date);
    if (content === null) {
      return c.json({ error: "当日暂无日报", content: null }, 404);
    }
    return c.json({ date, content, exists: true });
  });

  app.get("/api/daily", async (c) => {
    const date = (c.req.query("date") ?? todayDate()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date 格式应为 YYYY-MM-DD" }, 400);
    }
    const content = await readDigest(CACHE_DIR, date);
    if (content === null) {
      return c.json({ date, content: null, exists: false });
    }
    return c.json({ date, content, exists: true });
  });

  app.post("/api/daily/generate", async (c) => {
    const body = await c.req.json<{ date?: string; force?: boolean }>().catch(() => ({} as { date?: string; force?: boolean }));
    const date = body?.date ?? todayDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date 格式应为 YYYY-MM-DD" }, 400);
    }
    try {
      const result = await generateDigest(CACHE_DIR, date, body?.force ?? true);
      return c.json({ date: result.key, skipped: result.skipped, path: result.path });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
