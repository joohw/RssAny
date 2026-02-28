// 频道模块：读取 .rssany/channels.json，供首页 Feed API 使用

import { readFile } from "node:fs/promises";
import { CHANNELS_CONFIG_PATH } from "../../config/paths.js";
import type { ChannelConfig, ChannelConfigWithId, ChannelsMap } from "./types.js";

export type { ChannelConfig, ChannelConfigWithId, ChannelsMap } from "./types.js";


/** 从 .rssany/channels.json 加载配置，文件不存在或空则返回 {} */
export async function loadChannels(): Promise<ChannelsMap> {
  try {
    const raw = await readFile(CHANNELS_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const result: ChannelsMap = {};
    for (const [id, val] of Object.entries(parsed)) {
      if (val && typeof val === "object" && Array.isArray((val as { sourceRefs?: unknown }).sourceRefs)) {
        result[id] = val as ChannelConfig;
      }
    }
    return result;
  } catch {
    return {};
  }
}


/** 获取所有频道的完整配置（供 Feed API 与前端 Tab 使用） */
export async function getAllChannelConfigs(): Promise<ChannelConfigWithId[]> {
  const channels = await loadChannels();
  const entries = Object.entries(channels);
  if (entries.length === 0) {
    return [{ id: "all", title: "全部", sourceRefs: [] }];
  }
  return entries.map(([id, cfg]) => ({ id, ...cfg }));
}


/** 获取单个频道配置 */
export async function getChannelConfig(id: string): Promise<ChannelConfigWithId | null> {
  const channels = await loadChannels();
  const cfg = channels[id];
  if (!cfg) return null;
  return { id, ...cfg };
}


/** 计算「全部」对应的 sourceRefs：所有 channel 的 sourceRefs 的并集（去重） */
export function collectAllSourceRefs(channels: ChannelConfigWithId[]): string[] {
  const set = new Set<string>();
  for (const ch of channels) {
    for (const ref of ch.sourceRefs || []) {
      if (ref) set.add(ref);
    }
  }
  return [...set];
}
