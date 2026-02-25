// 插件加载器：从 plugins/*.rssany.{js,ts}（内置）和 .rssany/plugins/（用户）两个目录加载站点插件

import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Site } from "./site.js";
import { BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR } from "../../config/paths.js";


const PLUGIN_EXTENSIONS = [".rssany.js", ".rssany.ts"];


/** 判断对象是否为有效的 Site 实现（需提供 id、listUrlPattern 和 fetchItems） */
function isValidSite(obj: unknown): obj is Site {
  if (obj == null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    (typeof s.listUrlPattern === "string" || s.listUrlPattern instanceof RegExp) &&
    typeof s.fetchItems === "function"
  );
}


/** 从单个目录加载所有 *.rssany.{js,ts} 插件，返回 Site 数组 */
async function loadPluginsFromDir(dir: string, label: string): Promise<Site[]> {
  const plugins: Site[] = [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    const raw = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    entries = raw as { name: string; isFile: () => boolean }[];
  } catch {
    return plugins;
  }
  for (const e of entries) {
    const name = String(e.name);
    if (!e.isFile()) continue;
    if (!PLUGIN_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    const filePath = join(dir, name);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const site = mod.default ?? mod;
      if (isValidSite(site)) {
        plugins.push(site);
      } else {
        console.warn(`[Plugin][${label}] ${name} 未实现 Site 接口（需要 id、listUrlPattern、fetchItems），已跳过`);
      }
    } catch (err) {
      console.warn(`[Plugin][${label}] 加载 ${name} 失败:`, err);
    }
  }
  return plugins;
}


/** 加载所有插件：先加载内置（plugins/），再加载用户自定义（.rssany/plugins/），用户插件可覆盖同 id 的内置插件 */
export async function loadPlugins(): Promise<Site[]> {
  const [builtin, user] = await Promise.all([
    loadPluginsFromDir(BUILTIN_PLUGINS_DIR, "builtin"),
    loadPluginsFromDir(USER_PLUGINS_DIR, "user"),
  ]);
  const merged = new Map<string, Site>();
  for (const site of builtin) merged.set(site.id, site);
  for (const site of user) {
    if (merged.has(site.id)) {
      console.log(`[Plugin] 用户插件 "${site.id}" 覆盖同名内置插件`);
    }
    merged.set(site.id, site);
  }
  return Array.from(merged.values());
}
