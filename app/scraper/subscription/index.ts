// 信源配置模块：读取 .rssany/sources.json（扁平信源列表，供 scheduler 使用）

import { readFile, writeFile } from "node:fs/promises";
import { SOURCES_CONFIG_PATH } from "../../config/paths.js";
import type { SubscriptionSource, SourcesFile } from "./types.js";
import { resolveRef } from "./types.js";

export type { SubscriptionSource, SourcesFile } from "./types.js";
export { resolveRef } from "./types.js";


/** 从 .rssany/sources.json 加载；支持新格式 { sources: [] } 与旧格式 { [id]: { sources: [] } }，统一扁平为 SubscriptionSource[] */
async function loadSourcesFile(): Promise<SubscriptionSource[]> {
  try {
    const raw = await readFile(SOURCES_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    if (Array.isArray((parsed as SourcesFile).sources)) {
      return (parsed as SourcesFile).sources.filter((s) => resolveRef(s));
    }
    const entries = Object.values(parsed as Record<string, { sources?: SubscriptionSource[] }>);
    const list: SubscriptionSource[] = [];
    for (const entry of entries) {
      if (entry && Array.isArray(entry.sources)) {
        for (const s of entry.sources) {
          if (resolveRef(s)) list.push(s);
        }
      }
    }
    return list;
  } catch {
    return [];
  }
}


/** 获取所有信源（扁平列表），供 scheduler 使用 */
export async function getAllSources(): Promise<SubscriptionSource[]> {
  return loadSourcesFile();
}


/** 将扁平列表写回 sources.json（新格式）；供 raw API 写入 */
export async function saveSourcesFile(sources: SubscriptionSource[]): Promise<void> {
  await writeFile(
    SOURCES_CONFIG_PATH,
    JSON.stringify({ sources }, null, 2) + "\n",
    "utf-8"
  );
}


/** 读取 sources.json 原始内容（用于 GET /api/sources/raw）；旧格式会转为新格式返回 */
export async function getSourcesRaw(): Promise<string> {
  try {
    const raw = await readFile(SOURCES_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return JSON.stringify({ sources: [] }, null, 2);
    if (Array.isArray((parsed as SourcesFile).sources)) {
      return raw;
    }
    const list = await loadSourcesFile();
    return JSON.stringify({ sources: list }, null, 2);
  } catch {
    return JSON.stringify({ sources: [] }, null, 2);
  }
}
