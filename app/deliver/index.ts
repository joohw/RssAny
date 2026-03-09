/**
 * 投递：入库后将条目 POST 到配置的 URL
 *
 * 独立于 pipeline，由 config.json 的 deliver.url 控制。
 * 未配置 url 时不投递。
 */

import type { FeedItem } from "../types/feedItem.js";
import { loadDeliverConfig } from "./config.js";
import { logger } from "../core/logger/index.js";

/** 将条目 POST 到指定 URL，不写数据库 */
export async function deliverItemToUrl(
  item: FeedItem,
  url: string
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const target = url.trim();
  if (!target) return { ok: false, message: "URL 为空" };

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item], sourceRef: "deliver" }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/** 是否启用了投递（enabled 且配置了 url） */
export async function isDeliverEnabled(): Promise<boolean> {
  const config = await loadDeliverConfig();
  return config.enabled && !!config.url?.trim();
}

/**
 * 入库后投递：若 enabled 且配置了 deliver.url 则 POST，否则跳过
 */
export async function deliverItem(item: FeedItem): Promise<void> {
  const config = await loadDeliverConfig();
  if (!config.enabled || !config.url?.trim()) return;
  const url = config.url.trim();

  const result = await deliverItemToUrl(item, url);
  if (!result.ok) {
    logger.warn("deliver", "投递失败", {
      url,
      item_link: item.link,
      status: result.status,
      err: result.message,
    });
  }
}
