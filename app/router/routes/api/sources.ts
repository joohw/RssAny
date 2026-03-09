// /api/sources/stats、/api/sources/raw

import type { Hono } from "hono";
import { getSourceStats } from "../../../db/index.js";
import { getSourcesRaw, saveSourcesFile } from "../../../scraper/subscription/index.js";
import type { SourceType } from "../../../scraper/subscription/types.js";
import type { RefreshInterval } from "../../../utils/refreshInterval.js";
import { VALID_INTERVALS } from "../../../utils/refreshInterval.js";

export function registerSourcesRoutes(app: Hono): void {
  app.get("/api/sources/stats", async (c) => {
    const stats = await getSourceStats();
    return c.json(stats);
  });

  app.get("/api/sources/raw", async (c) => {
    try {
      const raw = await getSourcesRaw();
      return c.text(raw, 200, { "Content-Type": "application/json; charset=utf-8" });
    } catch {
      return c.text(JSON.stringify({ sources: [] }, null, 2), 200, { "Content-Type": "application/json; charset=utf-8" });
    }
  });

  app.put("/api/sources/raw", async (c) => {
    try {
      const body = await c.req.json<{ sources?: unknown[] }>();
      const list = Array.isArray(body?.sources) ? body.sources : [];
      const sources: { ref: string; type?: SourceType; label?: string; description?: string; refresh?: RefreshInterval; proxy?: string }[] = list
        .filter((s): s is Record<string, unknown> => s != null && typeof s === "object" && typeof (s as { ref?: unknown }).ref === "string")
        .map((s) => {
          const t = (s as { type?: string }).type;
          const type: SourceType | undefined =
            t === "web" || t === "rss" || t === "email" ? t : undefined;
          const r = (s as { refresh?: string }).refresh;
          const refresh: RefreshInterval | undefined =
            r && VALID_INTERVALS.includes(r as RefreshInterval) ? (r as RefreshInterval) : undefined;
          return {
            ref: String((s as { ref: string }).ref),
            type,
            label: (s as { label?: string }).label,
            description: (s as { description?: string }).description,
            refresh,
            proxy: (s as { proxy?: string }).proxy,
          };
        });
      await saveSourcesFile(sources);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
}
