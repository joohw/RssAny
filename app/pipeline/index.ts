// Pipeline 模块入口：注册内置步骤并导出

import { registerPipelineStep } from "./registry.js";
import { tagStep } from "./steps/tag.js";
import { translateStep } from "./steps/translate.js";


// 注册内置步骤（用户可通过 .rssany/pipeline/*.rssany.js 覆盖同名步骤）
registerPipelineStep("tag", tagStep);
registerPipelineStep("translate", translateStep);


export { runPipeline, runPipelineOnItem, clearPipelineConfigCache } from "./runner.js";
export { loadPipelineConfig } from "./config.js";
export { registerPipelineStep, registerPipelineSteps, getPipelineStep, getRegisteredStepNames } from "./registry.js";
export type { PipelineFn, PipelineContext, PipelineConfig, PipelineStep } from "./types.js";
