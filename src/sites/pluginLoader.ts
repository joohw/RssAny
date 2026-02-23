// 插件加载器：从 plugins/*.rssany.{js,ts} 加载外部站点插件（信任模型）

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Site } from "./types.js";


const PLUGINS_DIR = join(process.cwd(), "plugins");
const PLUGIN_EXTENSIONS = [".rssany.js", ".rssany.ts"];


/** 判断对象是否为有效的 Site 实现（插件需提供 parser 与 extractor） */
function isValidSite(obj: unknown): obj is Site {
  if (obj == null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    (typeof s.listUrlPattern === "string" || s.listUrlPattern instanceof RegExp) &&
    (typeof s.parser === "function" || s.parser == null) &&
    (typeof s.extractor === "function" || s.extractor == null)
  );
}


/** 从 plugins 目录加载所有 *.rssany.{js,ts} 插件，返回 Site 数组 */
export async function loadPlugins(): Promise<Site[]> {
  const plugins: Site[] = [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    const raw = await readdir(PLUGINS_DIR, { withFileTypes: true, encoding: "utf-8" });
    entries = raw as { name: string; isFile: () => boolean }[];
  } catch {
    return plugins;
  }
  for (const e of entries) {
    const name = String(e.name);
    if (!e.isFile()) continue;
    const hasValidExtension = PLUGIN_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!hasValidExtension) continue;
    const filePath = join(PLUGINS_DIR, name);
    const url = pathToFileURL(filePath).href;
    try {
      const mod = await import(url);
      const site = mod.default ?? mod;
      if (isValidSite(site)) {
        plugins.push(site);
      } else {
        console.warn(`[Plugin] ${name} 未实现 Site 接口，已跳过`);
      }
    } catch (err) {
      console.warn(`[Plugin] 加载 ${name} 失败:`, err);
    }
  }
  return plugins;
}
