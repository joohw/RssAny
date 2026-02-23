// 站点聚合：内置站点 + 外部插件（plugins/*.rssany.js）

export type { Site } from "./types.js";
export { getSiteByUrl, toAuthFlow, matchesListUrl, matchesDetailUrl, computeSpecificity, computeDetailSpecificity } from "./types.js";
export { loadPlugins } from "./pluginLoader.js";
import type { Site } from "./types.js";
import { getSiteByUrl, getSiteForExtraction as getSiteForExtractionImpl } from "./types.js";
import { loadPlugins } from "./pluginLoader.js";


/** 通用站点：匹配任意 URL，使用 LLM 解析与提取，兜底用 */
const genericSite: Site = {
  id: "generic",
  listUrlPattern: /^https?:\/\//,
  parser: undefined,
  extractor: undefined,
};


/** 内置站点（小红书已迁移至 plugins/xiaohongshu.rssany.js） */
const builtinSites: Site[] = [genericSite];


/** 已注册的站点列表 = 内置 + 插件（initSites 会合并） */
export const registeredSites: Site[] = [...builtinSites];


/** 初始化站点：加载 plugins/*.rssany.js 并合并到 registeredSites */
export async function initSites(): Promise<void> {
  const loadedPlugins = await loadPlugins();
  registeredSites.length = 0;
  registeredSites.push(...builtinSites, ...loadedPlugins);
}


/** 根据 URL 从已注册站点中查找匹配的站点（按 listUrlPattern，用于 RSS/parse） */
export function getSite(url: string): Site | undefined {
  return getSiteByUrl(url, registeredSites);
}


/** 根据详情页 URL 查找有 extractor 且域名匹配的站点（用于 /extractor，详情链接近乎不匹配 listUrlPattern） */
export function getSiteForExtraction(url: string): Site | undefined {
  return getSiteForExtractionImpl(url, registeredSites);
}


/** 根据站点 id 查找站点 */
export function getSiteById(id: string): Site | undefined {
  return registeredSites.find((s) => s.id === id);
}


