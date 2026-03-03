// Pipeline 步骤注册表：内置步骤 + 用户步骤

import type { PipelineFn, PipelineStep } from "./types.js";


const registry = new Map<string, PipelineFn>();


/** 注册一个 pipeline 步骤 */
export function registerPipelineStep(name: string, fn: PipelineFn): void {
  registry.set(name, fn);
}


/** 注册多个步骤（如 { name, run } 数组） */
export function registerPipelineSteps(steps: PipelineStep[]): void {
  for (const s of steps) {
    registry.set(s.name, s.run);
  }
}


/** 根据名称获取步骤，未找到返回 undefined */
export function getPipelineStep(name: string): PipelineFn | undefined {
  return registry.get(name);
}


/** 获取所有已注册步骤名称 */
export function getRegisteredStepNames(): string[] {
  return [...registry.keys()];
}
