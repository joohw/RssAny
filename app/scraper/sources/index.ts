// 统一信源注册表：汇聚 WebSource 插件、Source 插件（RSS/Email）、genericWebSource，提供 getSource 查找入口

import { createWebSource, genericWebSource, setLoadedSites } from "./web/index.js";
import { loadSiteAndSourcePlugins, loadEnrichPlugins, loadPipelinePlugins } from "./web/pluginLoader.js";
import type { Source } from "./types.js";
import { logger } from "../../core/logger/index.js";


/** 所有已注册的信源（按 priority 排序后迭代匹配） */
export const registeredSources: Source[] = [];

/** 将字符串 URL 模式转为正则：{placeholder} 匹配单个路径段，末尾允许 query */
function sourcePatternToRegex(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  const pathOnly = pattern.split("?")[0];
  const pl = "<<<__PL__>>>";
  const escaped = pathOnly
    .replace(/\{[^}]*\}/g, pl)
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c)
    .replace(new RegExp(pl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[^/]+");
  return new RegExp("^" + escaped + "(\\?.*)?$");
}


/** 根据 sourceId 查找匹配度最高的 Source；按 priority 升序，优先用 match 否则用 pattern */
export function getSource(sourceId: string): Source {
  for (const source of registeredSources) {
    const matches = source.match ? source.match(sourceId) : (() => {
      try {
        return sourcePatternToRegex(source.pattern).test(sourceId);
      } catch {
        return false;
      }
    })();
    if (matches) return source;
  }
  return genericWebSource;
}


/** 根据 id 精确查找 Source（用于内部调试） */
export function getSourceById(id: string): Source | undefined {
  return registeredSources.find((s) => s.id === id);
}


/** 初始化所有信源及 enrich/pipeline 插件：加载三阶段插件、构建注册表 */
export async function initSources(): Promise<void> {
  const [siteResult] = await Promise.all([
    loadSiteAndSourcePlugins(),
    loadEnrichPlugins(),
    loadPipelinePlugins(),
  ]);
  const { sites, sources: sourcePlugins } = siteResult;
  setLoadedSites(sites);
  registeredSources.length = 0;
  const webSources = sites.map((s) => createWebSource(s));
  const all: Source[] = [
    ...sourcePlugins,
    ...webSources,
    genericWebSource,
  ];
  all.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  registeredSources.push(...all);
  logger.info("source", "信源已注册", {
    total: registeredSources.length,
    siteCount: sites.length,
    sourcePluginCount: sourcePlugins.length,
  });
}
