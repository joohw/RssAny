// WebSource：将 Site 插件包装为 Source 接口，注入 SiteContext 工具

import { fetchHtml as fetchHtmlFn, preCheckAuth } from "./fetcher/index.js";
import { parseHtml } from "./parser/index.js";
import { toAuthFlow, getSiteByUrl } from "./site.js";
import { AuthRequiredError } from "../../auth/index.js";
import type { Site, SiteContext } from "./site.js";
import type { Source, SourceContext } from "../types.js";
import type { FeedItem } from "../../types/feedItem.js";


/** 从 SourceContext + Site 构建注入了工具的 SiteContext */
export function buildSiteContext(site: Site, ctx: SourceContext): SiteContext {
  const proxy = ctx.proxy ?? site.proxy;
  const authFlow = toAuthFlow(site);
  return {
    cacheDir: ctx.cacheDir,
    headless: ctx.headless,
    proxy,
    async fetchHtml(url, opts) {
      const res = await fetchHtmlFn(url, {
        cacheDir: ctx.cacheDir,
        useCache: false,
        authFlow,
        headless: ctx.headless,
        proxy,
        waitAfterLoadMs: opts?.waitMs,
      });
      return { html: res.body, finalUrl: res.finalUrl ?? url, status: res.status };
    },
  };
}


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
      return site.fetchItems(sourceId, buildSiteContext(site, ctx));
    },
    enrichItem: site.enrichItem
      ? async (item: FeedItem, ctx: SourceContext): Promise<FeedItem> => {
          return site.enrichItem!(item, buildSiteContext(site, ctx));
        }
      : undefined,
  };
}


/** 通用 WebSource：兜底匹配所有 http/https URL，使用浏览器抓取 + LLM 解析 */
export const genericWebSource: Source = {
  id: "generic",
  pattern: /^https?:\/\//,
  async fetchItems(sourceId: string, ctx: SourceContext): Promise<FeedItem[]> {
    const res = await fetchHtmlFn(sourceId, {
      cacheDir: ctx.cacheDir,
      useCache: false,
      headless: ctx.headless,
      proxy: ctx.proxy,
    });
    if (res.status !== 200) {
      throw new Error(`抓取失败: HTTP ${res.status} ${res.statusText}`);
    }
    const parsed = await parseHtml(res.body, {
      url: res.finalUrl ?? sourceId,
      cacheDir: ctx.cacheDir,
      useCache: false,
    });
    return parsed.items;
  },
};


/** 保存已加载的 Site 对象（供 auth 路由、调试路由直接访问） */
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


/** 根据 URL 获取最具体匹配的 Site（用于调试路由） */
export function getBestSite(url: string): Site | undefined {
  return getSiteByUrl(url, loadedSites);
}


export type { Site, SiteContext } from "./site.js";
export { toAuthFlow, computeSpecificity } from "./site.js";
export { loadPlugins } from "./pluginLoader.js";
