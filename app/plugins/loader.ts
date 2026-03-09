// 插件加载器：从 plugins/{sources,enrich}/ 和 .rssany/plugins/{sources,enrich}/ 加载信源与 enrich 插件
// pipeline 已移至 app/pipeline/ 作为固定流程，不再作为插件

import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Site } from "../scraper/sources/web/site.js";
import type { Source } from "../scraper/sources/types.js";
import {
  BUILTIN_SOURCES_DIR,
  USER_SOURCES_DIR,
  BUILTIN_ENRICH_DIR,
  USER_ENRICH_DIR,
  BUILTIN_PLUGINS_DIR,
  USER_PLUGINS_DIR,
} from "../config/paths.js";
import { logger } from "../core/logger/index.js";
import type { FeedItem } from "../types/feedItem.js";


/** LLM 帮助函数，由 feeder 注入到插件上下文 */
export interface PluginLlm {
  chatJson: (prompt: string, config?: Record<string, unknown>, options?: { maxTokens?: number; debugLabel?: string }) => Promise<Record<string, unknown>>;
  chatText: (prompt: string, config?: Record<string, unknown>, options?: { maxTokens?: number; debugLabel?: string }) => Promise<string>;
}

/** DB 帮助函数，由 feeder 注入到插件上下文 */
export interface PluginDb {
  getSystemTags: () => Promise<string[]>;
}

/** 插件统一上下文，由 feeder 在执行前注入 llm / db */
export interface PluginContext {
  sourceUrl?: string;
  isEnriched?: boolean;
  llm?: PluginLlm;
  db?: PluginDb;
  [key: string]: unknown;
}


const PLUGIN_EXTENSIONS = [".rssany.js", ".rssany.ts"];


/** Enrich 插件上下文（提供 fetchHtml、extractItem 等） */
export interface EnrichContext {
  cacheDir?: string;
  headless?: boolean;
  proxy?: string;
  sourceUrl?: string;
  fetchHtml(url: string, opts?: { waitMs?: number; purify?: boolean }): Promise<{ html: string; finalUrl: string; status: number }>;
  extractItem(item: FeedItem, opts?: { cacheKey?: string }): Promise<FeedItem>;
}

/** Enrich 插件：对条目补全正文等 */
export interface EnrichPlugin {
  id: string;
  match: (item: FeedItem, ctx: { sourceUrl?: string }) => boolean;
  enrichItem: (item: FeedItem, ctx: EnrichContext) => Promise<FeedItem>;
  priority?: number;
}

/** 判断对象是否为有效的 Site 实现 */
function isValidSite(obj: unknown): obj is Site {
  if (obj == null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    (typeof s.listUrlPattern === "string" || s.listUrlPattern instanceof RegExp) &&
    typeof s.fetchItems === "function"
  );
}

/** 判断对象是否为有效的 Source 实现 */
function isValidSource(obj: unknown): obj is Source {
  if (obj == null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    (typeof s.pattern === "string" || s.pattern instanceof RegExp) &&
    typeof s.fetchItems === "function" &&
    s.listUrlPattern === undefined
  );
}

/** 判断对象是否为有效的 EnrichPlugin */
function isValidEnrichPlugin(obj: unknown): obj is EnrichPlugin {
  if (obj == null || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return typeof p.id === "string" && typeof p.match === "function" && typeof p.enrichItem === "function";
}

/** 从单个目录加载 Site / Source 插件 */
async function loadSourcePluginsFromDir(
  dir: string,
  label: string,
): Promise<{ sites: Site[]; sources: Source[] }> {
  const sites: Site[] = [];
  const sources: Source[] = [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    const raw = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    entries = raw as { name: string; isFile: () => boolean }[];
  } catch {
    return { sites, sources };
  }
  for (const e of entries) {
    const name = String(e.name);
    if (!e.isFile()) continue;
    if (!PLUGIN_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    const filePath = join(dir, name);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const plugin = mod.default ?? mod;
      if (isValidSite(plugin)) {
        sites.push(plugin);
      } else if (isValidSource(plugin)) {
        sources.push(plugin);
      } else {
        logger.warn("plugin", "插件未实现 Site 或 Source 接口，已跳过", { label, name });
      }
    } catch (err) {
      logger.warn("plugin", "插件加载失败", { label, name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sites, sources };
}


/** 从单个目录加载指定类型插件 */
async function loadPluginsFromDir<T>(
  dir: string,
  label: string,
  validator: (obj: unknown) => obj is T,
): Promise<T[]> {
  const result: T[] = [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    const raw = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    entries = raw as { name: string; isFile: () => boolean }[];
  } catch {
    return result;
  }
  for (const e of entries) {
    const name = String(e.name);
    if (!e.isFile()) continue;
    if (!PLUGIN_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    const filePath = join(dir, name);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const plugin = mod.default ?? mod;
      if (validator(plugin)) {
        result.push(plugin);
      } else {
        logger.warn("plugin", "插件接口不匹配，已跳过", { label, name });
      }
    } catch (err) {
      logger.warn("plugin", "插件加载失败", { label, name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}


/** 加载 sources 目录，若不存在或为空则回退到 plugins 根目录 */
async function loadFromSourcesOrRoot(): Promise<{
  builtin: { sites: Site[]; sources: Source[] };
  user: { sites: Site[]; sources: Source[] };
}> {
  const [builtinFromSources, userFromSources] = await Promise.all([
    loadSourcePluginsFromDir(BUILTIN_SOURCES_DIR, "builtin:sources"),
    loadSourcePluginsFromDir(USER_SOURCES_DIR, "user:sources"),
  ]);
  const hasAny =
    builtinFromSources.sites.length +
    builtinFromSources.sources.length +
    userFromSources.sites.length +
    userFromSources.sources.length > 0;
  if (hasAny) return { builtin: builtinFromSources, user: userFromSources };
  const [builtinRoot, userRoot] = await Promise.all([
    loadSourcePluginsFromDir(BUILTIN_PLUGINS_DIR, "builtin"),
    loadSourcePluginsFromDir(USER_PLUGINS_DIR, "user"),
  ]);
  return { builtin: builtinRoot, user: userRoot };
}


/** 加载所有 Site 插件；用户插件可覆盖同 id 内置 */
export async function loadPlugins(): Promise<Site[]> {
  const { builtin, user } = await loadFromSourcesOrRoot();
  const merged = new Map<string, Site>();
  for (const site of builtin.sites) merged.set(site.id, site);
  for (const site of user.sites) {
    if (merged.has(site.id)) logger.info("plugin", "用户插件覆盖同名内置插件", { pluginId: site.id });
    merged.set(site.id, site);
  }
  return Array.from(merged.values());
}


/** 加载所有 Source 插件；用户插件可覆盖同 id */
export async function loadSourcePlugins(): Promise<Source[]> {
  const { builtin, user } = await loadFromSourcesOrRoot();
  const merged = new Map<string, Source>();
  for (const src of builtin.sources) merged.set(src.id, src);
  for (const src of user.sources) {
    if (merged.has(src.id)) logger.info("plugin", "用户 Source 插件覆盖同名内置", { sourceId: src.id });
    merged.set(src.id, src);
  }
  return Array.from(merged.values());
}


/** 加载 Site 与 Source：合并去重，供 initSources 使用 */
export async function loadSiteAndSourcePlugins(): Promise<{ sites: Site[]; sources: Source[] }> {
  const { builtin, user } = await loadFromSourcesOrRoot();
  const siteMap = new Map<string, Site>();
  const sourceMap = new Map<string, Source>();
  for (const s of builtin.sites) siteMap.set(s.id, s);
  for (const s of user.sites) {
    if (siteMap.has(s.id)) logger.info("plugin", "用户插件覆盖同名内置", { pluginId: s.id });
    siteMap.set(s.id, s);
  }
  for (const s of builtin.sources) sourceMap.set(s.id, s);
  for (const s of user.sources) {
    if (sourceMap.has(s.id)) logger.info("plugin", "用户 Source 插件覆盖同名内置", { sourceId: s.id });
    sourceMap.set(s.id, s);
  }
  return { sites: Array.from(siteMap.values()), sources: Array.from(sourceMap.values()) };
}


/** 已加载的 Enrich 插件（按 priority 排序） */
export let registeredEnrichPlugins: EnrichPlugin[] = [];


/** 加载 Enrich 插件 */
export async function loadEnrichPlugins(): Promise<EnrichPlugin[]> {
  const [builtin, user] = await Promise.all([
    loadPluginsFromDir(BUILTIN_ENRICH_DIR, "builtin:enrich", isValidEnrichPlugin),
    loadPluginsFromDir(USER_ENRICH_DIR, "user:enrich", isValidEnrichPlugin),
  ]);
  const merged = new Map<string, EnrichPlugin>();
  for (const p of builtin) merged.set(p.id, p);
  for (const p of user) {
    if (merged.has(p.id)) logger.info("plugin", "用户 Enrich 插件覆盖同名内置", { pluginId: p.id });
    merged.set(p.id, p);
  }
  const list = Array.from(merged.values());
  list.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  registeredEnrichPlugins = list;
  return list;
}


/** 根据条目获取匹配的 Enrich 插件（优先级最高者） */
export function getMatchedEnrichPlugin(item: FeedItem, ctx: { sourceUrl?: string }): EnrichPlugin | undefined {
  return registeredEnrichPlugins.find((p) => p.match(item, ctx));
}


