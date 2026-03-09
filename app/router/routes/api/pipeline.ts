// /api/pipeline（步骤开关与排序）

import type { Hono } from "hono";
import {
  loadPipelineConfig,
  savePipelineConfig,
  DEFAULT_PIPELINE_STEPS,
  PIPELINE_STEP_IDS,
} from "../../../pipeline/config.js";

type StepInput = { id: string; enabled?: boolean };

function parseSteps(rawSteps: unknown[]): Array<{ id: string; enabled: boolean }> {
  return rawSteps
    .filter((s) => s && typeof s === "object" && typeof (s as StepInput).id === "string")
    .map((s) => {
      const obj = s as StepInput;
      const e: unknown = obj.enabled;
      return {
        id: String(obj.id).trim(),
        enabled: e !== false && e !== 0,
      };
    })
    .filter((s) => s.id.length > 0);
}

function dedupeSteps<T extends { id: string }>(steps: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of steps) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

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
      const body = await c.req.json<{ steps?: unknown[] }>();
      const rawSteps = Array.isArray(body?.steps) ? body.steps : [];
      const steps = dedupeSteps(parseSteps(rawSteps));
      await savePipelineConfig({ steps });
      return c.json({ ok: true, steps });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
}
