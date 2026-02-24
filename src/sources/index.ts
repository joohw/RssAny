// 统一信源注册表：汇聚 WebSource 插件、RssSource、genericWebSource，提供 getSource 查找入口

import { loadPlugins, createWebSource, genericWebSource, setLoadedSites } from "./web/index.js";
import { rssSource, looksLikeFeed } from "./api/rss.js";
import { emailSource } from "./email/index.js";
import type { Source } from "./types.js";


/** 所有已注册的信源（优先级从高到低：Web 插件 → RssSource → genericWebSource） */
export const registeredSources: Source[] = [];


/** 根据 sourceId 查找匹配度最高的 Source */
export function getSource(sourceId: string): Source {
  // 优先：IMAP 邮件信源
  if (/^imaps?:\/\//.test(sourceId)) return emailSource;
  // 次优先：Web 插件（具体 URL 模式）
  const webPlugins = registeredSources.filter((s) => s.id !== "__rss__" && s.id !== "generic");
  for (const source of webPlugins) {
    const pattern = source.pattern;
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    if (regex.test(sourceId)) return source;
  }
  // 次优先：标准 Feed URL（启发式判断）
  if (looksLikeFeed(sourceId)) {
    return rssSource;
  }
  // 兜底：通用 WebSource（LLM 解析）
  return genericWebSource;
}


/** 根据 id 精确查找 Source（用于内部调试） */
export function getSourceById(id: string): Source | undefined {
  return registeredSources.find((s) => s.id === id);
}


/** 初始化所有信源：加载插件、构建注册表 */
export async function initSources(): Promise<void> {
  const sites = await loadPlugins();
  setLoadedSites(sites);
  registeredSources.length = 0;
  for (const site of sites) {
    registeredSources.push(createWebSource(site));
  }
  registeredSources.push(rssSource);
  registeredSources.push(genericWebSource);
  console.log(`[Sources] 已注册 ${registeredSources.length} 个信源（${sites.length} 个 Web 插件 + 1 个 RSS + 1 个邮件 + 1 个通用）`);
}
