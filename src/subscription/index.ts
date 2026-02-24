// 订阅模块：读取 .rssany/subscriptions.json，并发拉取各信源条目，聚合后返回

import { readFile, writeFile } from "node:fs/promises";
import { getItems } from "../feeder/index.js";
import type { FeedItem } from "../types/feedItem.js";
import type { SubscriptionConfig, SubscriptionsMap } from "./types.js";
import { resolveRef } from "./types.js";
import { SUBSCRIPTIONS_CONFIG_PATH } from "../config/paths.js";

export type { SubscriptionConfig, SubscriptionsMap, SubscriptionSource, SourceType } from "./types.js";


/** 订阅聚合结果 */
export interface SubscriptionResult {
  id: string;
  title?: string;
  description?: string;
  items: FeedItem[];
  /** 各信源拉取结果：fulfilled 表示成功，rejected 表示失败（ref + reason） */
  sourceResults: Array<{ ref: string; label?: string; status: "fulfilled" | "rejected"; count?: number; reason?: string }>;
}


// 从 .rssany/subscriptions.json 加载配置，文件不存在则返回空对象
async function loadSubscriptions(): Promise<SubscriptionsMap> {
  try {
    const raw = await readFile(SUBSCRIPTIONS_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as SubscriptionsMap;
  } catch {
    return {};
  }
}


// 将 SubscriptionsMap 持久化到 .rssany/subscriptions.json
async function saveSubscriptions(subs: SubscriptionsMap): Promise<void> {
  await writeFile(SUBSCRIPTIONS_CONFIG_PATH, JSON.stringify(subs, null, 2) + "\n", "utf-8");
}


/** 获取指定订阅的聚合条目列表；各信源并发拉取，单源失败不影响整体 */
export async function getSubscription(id: string, cacheDir = "cache"): Promise<SubscriptionResult | null> {
  const subs = await loadSubscriptions();
  const config = subs[id];
  if (!config) return null;
  const settled = await Promise.allSettled(
    config.sources.map((src) => {
      const ref = resolveRef(src);
      return getItems(ref, { cacheDir, refreshInterval: src.refresh, proxy: src.proxy }).then((items) => ({ ref, label: src.label, items }));
    })
  );
  const allItems: FeedItem[] = [];
  const sourceResults: SubscriptionResult["sourceResults"] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const src = config.sources[i];
    const ref = resolveRef(src);
    const label = src.label;
    if (result.status === "fulfilled") {
      const sourceItems = config.maxItemsPerSource ? result.value.items.slice(0, config.maxItemsPerSource) : result.value.items;
      allItems.push(...sourceItems);
      sourceResults.push({ ref, label, status: "fulfilled", count: sourceItems.length });
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      sourceResults.push({ ref, label, status: "rejected", reason });
    }
  }
  allItems.sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));
  return { id, title: config.title, description: config.description, items: allItems, sourceResults };
}


/** 列出所有已配置的订阅（精简信息，用于列表展示） */
export async function listSubscriptions(): Promise<Array<{ id: string; title?: string; sourceCount: number }>> {
  const subs = await loadSubscriptions();
  return Object.entries(subs).map(([id, cfg]) => ({ id, title: cfg.title, sourceCount: cfg.sources.length }));
}


/** 获取所有订阅的完整配置（管理页面用） */
export async function getAllSubscriptionConfigs(): Promise<Array<{ id: string } & SubscriptionConfig>> {
  const subs = await loadSubscriptions();
  return Object.entries(subs).map(([id, cfg]) => ({ id, ...cfg }));
}


/** 获取单个订阅的完整配置（管理页面编辑用） */
export async function getSubscriptionConfig(id: string): Promise<SubscriptionConfig | null> {
  const subs = await loadSubscriptions();
  return subs[id] ?? null;
}


/** 创建或更新订阅配置；id 已存在则覆盖 */
export async function createOrUpdateSubscription(id: string, config: SubscriptionConfig): Promise<void> {
  const subs = await loadSubscriptions();
  subs[id] = config;
  await saveSubscriptions(subs);
}


/** 删除订阅；不存在时返回 false */
export async function deleteSubscription(id: string): Promise<boolean> {
  const subs = await loadSubscriptions();
  if (!subs[id]) return false;
  delete subs[id];
  await saveSubscriptions(subs);
  return true;
}
