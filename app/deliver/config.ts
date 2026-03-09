/**
 * 投递配置：从 .rssany/config.json 的 deliver 块读取
 *
 * 格式：{ "deliver": { "enabled": false, "url": "https://..." } }
 * - enabled 为 true 且 url 已设置时，不写数据库，仅 POST 到该 URL（纯转发节点）
 * - 否则正常入库
 */

import { readFile, writeFile } from "node:fs/promises";
import { CONFIG_PATH } from "../config/paths.js";

export interface DeliverConfig {
  enabled: boolean;
  url?: string;
}

/** 读取投递配置 */
export async function loadDeliverConfig(): Promise<DeliverConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { deliver?: { enabled?: unknown; url?: string } };
    const d = parsed?.deliver;
    const enabled = d?.enabled === true || d?.enabled === 1;
    const url = typeof d?.url === "string" ? d.url.trim() : undefined;
    return { enabled, url: url || undefined };
  } catch {
    return { enabled: false };
  }
}

/** 保存投递配置到 config.json（合并其他块，不覆盖） */
export async function saveDeliverConfig(config: DeliverConfig): Promise<void> {
  let root: Record<string, unknown> = {};
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 文件不存在或解析失败，使用空对象
  }
  root.deliver = { enabled: config.enabled, url: config.url ?? "" };
  await writeFile(CONFIG_PATH, JSON.stringify(root, null, 2), "utf-8");
}
