// WebSource：将 Site 插件包装为 Source 接口，封装 fetch→parse→extract 三步流水线

import { cacheKey } from "../../cacher/index.js";
import { fetchHtml, preCheckAuth } from "./fetcher/index.js";
import { parseHtml } from "./parser/index.js";
import { extractItem } from "./extractor/index.js";
import { toAuthFlow, getSiteForExtraction, computeSpecificity } from "./site.js";
import { AuthRequiredError } from "../../auth/index.js";
import type { Site } from "./site.js";
import type { Source, SourceContext } from "../types.js";
import type { FeedItem } from "../../types/feedItem.js";


/** 将 Site 插件包装为统一 Source 接口 */
export function createWebSource(site: Site): Source {
  const authFlow = toAuthFlow(site);
  return {
    id: site.id,
    pattern: site.listUrlPattern,
    refreshInterval: site.refreshInterval ?? undefined,
    proxy: site.proxy ?? undefined,
    preCheck: authFlow
      ? async (ctx: SourceContext) => {
          if (!ctx.cacheDir) return;
          const passed = await preCheckAuth(authFlow, ctx.cacheDir);
          if (!passed) throw new AuthRequiredError(`站点 ${site.id} 需要登录，请先执行 ensureAuth`);
        }
      : undefined,
    async fetchItems(sourceId: string, ctx: SourceContext): Promise<FeedItem[]> {
      const proxy = ctx.proxy ?? site.proxy;
      const listRes = await fetchHtml(sourceId, {
        cacheDir: ctx.cacheDir,
        useCache: false,
        authFlow,
        headless: ctx.headless,
        proxy,
        browserContext: site.browserContext ?? undefined,
        waitAfterLoadMs: site.waitAfterLoadMs ?? undefined,
      });
      if (listRes.status !== 200) {
        throw new Error(`抓取失败: HTTP ${listRes.status} ${listRes.statusText}`);
      }
      const parsed = await parseHtml(listRes.body, {
        url: listRes.finalUrl ?? sourceId,
        customParser: site.parser ?? undefined,
        cacheDir: ctx.cacheDir,
        useCache: false,
        cacheKey: cacheKey(listRes.finalUrl ?? sourceId, "forever"),
      });
      return parsed.items;
    },
    enrichItem: site.extractor != null
      ? async (item: FeedItem, ctx: SourceContext): Promise<FeedItem> => {
          return extractItem(
            item,
            { cacheDir: ctx.cacheDir, useCache: false, customExtractor: site.extractor! },
            { cacheDir: ctx.cacheDir, headless: ctx.headless, proxy: ctx.proxy ?? site.proxy, browserContext: site.browserContext ?? undefined },
          );
        }
      : undefined,
  };
}


/** 通用 WebSource：兜底匹配所有 http/https URL，使用 LLM 解析，无正文提取 */
export const genericWebSource: Source = createWebSource({
  id: "generic",
  listUrlPattern: /^https?:\/\//,
  parser: undefined,
  extractor: undefined,
});


/** 保存已加载的 Site 对象（供 auth 路由、extractor 路由直接访问底层 Site） */
const loadedSites: Site[] = [];


/** 更新已加载站点列表（由 sources/index.ts 调用） */
export function setLoadedSites(sites: Site[]): void {
  loadedSites.length = 0;
  loadedSites.push(...sites);
}


/** 根据 id 获取底层 Site（用于 auth 路由） */
export function getWebSite(id: string): Site | undefined {
  return loadedSites.find((s) => s.id === id);
}


/** 获取所有已加载的 Site（用于插件列表 API） */
export function getPluginSites(): Site[] {
  return loadedSites.filter((s) => s.id !== "generic");
}


/** 根据详情页 URL 查找有 extractor 且匹配的 Site（用于 /extractor 调试路由） */
export function getSiteForDetail(url: string): Site | undefined {
  return getSiteForExtraction(url, loadedSites);
}


/** 根据 URL 获取最具体匹配的 Site（用于 /parse 调试路由） */
export function getBestSite(url: string): Site | undefined {
  const matched = loadedSites
    .map((s) => ({ site: s, score: computeSpecificity(s, url) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return matched[0]?.site;
}


export type { Site } from "./site.js";
export { toAuthFlow, computeSpecificity } from "./site.js";
export { loadPlugins } from "./pluginLoader.js";
