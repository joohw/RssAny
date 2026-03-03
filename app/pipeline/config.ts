// Pipeline 配置加载：从 .rssany/config.json 读取

import { readFile } from "node:fs/promises";
import { USER_DIR } from "../config/paths.js";
import { join } from "node:path";
import type { PipelineConfig } from "./types.js";


const DEFAULTS: PipelineConfig = {
  enabled: false,
  steps: [],
};


/** 读取 .rssany/config.json 中的 pipeline 块 */
export async function loadPipelineConfig(): Promise<PipelineConfig> {
  try {
    const raw = await readFile(join(USER_DIR, "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const p = parsed.pipeline;
    if (!p || typeof p !== "object") return DEFAULTS;
    const obj = p as Record<string, unknown>;
    return {
      enabled: obj.enabled === true,
      steps: Array.isArray(obj.steps) ? obj.steps.filter((s): s is string => typeof s === "string") : DEFAULTS.steps ?? [],
    };
  } catch {
    return DEFAULTS;
  }
}
