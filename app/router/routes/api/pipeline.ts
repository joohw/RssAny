// /api/pipeline（步骤开关与排序）

import type { Hono } from "hono";
import { loadPipelineConfig, savePipelineConfig, DEFAULT_PIPELINE_STEPS, PIPELINE_STEP_IDS } from "../../../pipeline/config.js";

export function registerPipelineRoutes(app: Hono): void {
  app.get("/api/pipeline", async (c) => {
    const config = await loadPipelineConfig();
    return c.json({
      steps: config.steps,
      availableIds: [...PIPELINE_STEP_IDS],
      defaults: DEFAULT_PIPELINE_STEPS,
    });
  });

  app.put("/api/pipeline", async (c) => {
    try {
      const body = await c.req.json<{ steps?: Array<{ id: string; enabled?: boolean }> }>();
      const rawSteps = Array.isArray(body?.steps) ? body.steps : [];
      const steps = rawSteps
        .filter((s) => s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string")
        .map((s) => ({
          id: String((s as { id: string }).id).trim(),
          enabled: (s as { enabled?: unknown }).enabled !== false && (s as { enabled?: unknown }).enabled !== 0,
        }))
        .filter((s) => s.id.length > 0);
      const seen = new Set<string>();
      const deduped: Array<{ id: string; enabled: boolean }> = [];
      for (const s of steps) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        deduped.push(s);
      }
      await savePipelineConfig({ steps: deduped });
      return c.json({ ok: true, steps: deduped });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
}
