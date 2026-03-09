/**
 * Pipeline 配置：从 .rssany/config.json 的 pipeline 块读取
 *
 * 格式：{ "pipeline": { "steps": [{ "id": "tagger", "enabled": false }, ...] } }
 * - steps 数组顺序即执行顺序，可自由调整
 * - enabled: false 的步骤跳过
 * - 未配置时使用默认：tagger、translator 均禁用
 */

import { readFile, writeFile } from "node:fs/promises";
import { CONFIG_PATH } from "../config/paths.js";

export interface PipelineStepConfig {
  id: string;
  enabled: boolean;
}

export interface PipelineConfig {
  steps: PipelineStepConfig[];
}

/** 内置步骤默认配置（顺序 + 默认禁用） */
export const DEFAULT_PIPELINE_STEPS: PipelineStepConfig[] = [
  { id: "tagger", enabled: false },
  { id: "translator", enabled: false },
];

/** 所有可用的 pipeline 步骤 id */
export const PIPELINE_STEP_IDS = ["tagger", "translator"] as const;

/** 读取 pipeline 配置，缺失时返回默认 */
export async function loadPipelineConfig(): Promise<PipelineConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { pipeline?: { steps?: unknown[] } };
    const rawSteps = Array.isArray(parsed?.pipeline?.steps) ? parsed.pipeline.steps : [];
    const steps: PipelineStepConfig[] = [];
    const seen = new Set<string>();
    for (const s of rawSteps) {
      if (s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string") {
        const id = (s as { id: string }).id.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const enabled = (s as { enabled?: unknown }).enabled;
        steps.push({
          id,
          enabled: enabled !== false && enabled !== 0,
        });
      }
    }
    if (steps.length > 0) return { steps };
  } catch {
    // 文件不存在或解析失败
  }
  return { steps: [...DEFAULT_PIPELINE_STEPS] };
}

/** 保存 pipeline 配置到 config.json（合并其他块，不覆盖） */
export async function savePipelineConfig(config: PipelineConfig): Promise<void> {
  let root: Record<string, unknown> = {};
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 文件不存在或解析失败，使用空对象
  }
  root.pipeline = { steps: config.steps };
  await writeFile(CONFIG_PATH, JSON.stringify(root, null, 2), "utf-8");
}
