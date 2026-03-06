// 话题/日报生成：Daily = topic/日期，统一存储与生成逻辑

import { mkdir, stat, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runDigestAgent, isDateKey } from "./agent.js";
import { logger } from "../core/logger/index.js";
import { getSystemTags, getTagPeriods } from "../db/index.js";
import { queryItems, getItemsForDate } from "../db/index.js";


const TOPICS_SUBDIR = "topics";
const DAILY_SUBDIR = "daily";


/** 话题名转安全的文件名（保留中文等，仅替换路径非法字符） */
function topicToFilename(topic: string): string {
  return topic.replace(/[/\\:*?"<>|]/g, "_").trim() || "default";
}


/** 统一：key 为日期时用 daily/，否则用 topics/ */
export function digestFilePath(cacheDir: string, key: string): string {
  if (isDateKey(key)) {
    return join(cacheDir, DAILY_SUBDIR, `${key}.md`);
  }
  return join(cacheDir, TOPICS_SUBDIR, `${topicToFilename(key)}.md`);
}


/** 话题报告缓存文件路径 */
export function topicFilePath(cacheDir: string, topic: string): string {
  return digestFilePath(cacheDir, topic);
}


/** 检查指定 key 的报告是否已生成 */
export async function digestExists(cacheDir: string, key: string): Promise<boolean> {
  return stat(digestFilePath(cacheDir, key)).then(() => true).catch(() => false);
}


/** 读取报告内容，不存在返回 null。key 为日期或话题 */
export async function readDigest(cacheDir: string, key: string): Promise<string | null> {
  try {
    return await readFile(digestFilePath(cacheDir, key), "utf-8");
  } catch {
    return null;
  }
}


/** 读取指定话题的报告内容，不存在返回 null */
export async function readTopicDigest(cacheDir: string, topic: string): Promise<string | null> {
  return readDigest(cacheDir, topic);
}


/** 检查指定话题的报告是否已生成 */
export async function topicExists(cacheDir: string, topic: string): Promise<boolean> {
  return digestExists(cacheDir, topic);
}


/** 列出指定类型的已有报告 key（daily 返回日期列表，topics 返回话题列表） */
export async function listDigestDates(cacheDir: string, type: "daily" | "topics" = "daily"): Promise<string[]> {
  const subdir = type === "daily" ? DAILY_SUBDIR : TOPICS_SUBDIR;
  const dir = join(cacheDir, subdir);
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}


/**
 * 统一生成报告：key 为日期时生成日报，否则生成话题追踪
 */
export async function generateDigest(
  cacheDir: string,
  key: string,
  force = false
): Promise<{ key: string; skipped: boolean; path: string }> {
  const filePath = digestFilePath(cacheDir, key);
  if (!force && await digestExists(cacheDir, key)) {
    logger.debug("daily", "报告已存在，跳过生成", { key });
    return { key, skipped: true, path: filePath };
  }
  if (isDateKey(key)) {
    return doGenerateDaily(cacheDir, key, filePath);
  }
  return doGenerateTopic(cacheDir, key, filePath);
}

async function doGenerateDaily(
  cacheDir: string,
  date: string,
  filePath: string
): Promise<{ key: string; skipped: boolean; path: string }> {
  const items = await getItemsForDate(date);
  if (items.length === 0) {
    logger.info("daily", "当日无条目，跳过生成", { date });
    return { key: date, skipped: true, path: filePath };
  }
  logger.info("daily", "开始生成日报（Agent）", { date, itemCount: items.length });

  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const previousArticle = await readDigest(cacheDir, prevDate.toISOString().slice(0, 10));

  let agentContent: string;
  try {
    agentContent = await runDigestAgent(date, { previousArticle });
  } catch (err) {
    logger.error("daily", "日报生成失败", { date, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const header = `# 日报 · ${date}\n\n> Agent 生成于 ${now}，共整理 ${items.length} 篇文章\n\n`;
  await mkdir(join(cacheDir, DAILY_SUBDIR), { recursive: true });
  await writeFile(filePath, header + agentContent, "utf-8");
  logger.info("daily", "日报生成完成", { date, path: filePath });
  return { key: date, skipped: false, path: filePath };
}

async function doGenerateTopic(
  cacheDir: string,
  topic: string,
  filePath: string
): Promise<{ key: string; skipped: boolean; path: string }> {
  const periods = await getTagPeriods();
  const periodDays = Math.max(1, periods[topic] ?? 1);
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const until = new Date();
  until.setDate(until.getDate() + 1);

  const result = await queryItems({
    tags: [topic],
    since,
    until,
    limit: 1,
    offset: 0,
  });
  if (result.items.length === 0 && result.total === 0) {
    logger.info("daily", "该话题近期无文章，跳过生成", { topic, periodDays });
    return { key: topic, skipped: true, path: filePath };
  }
  logger.info("daily", "开始生成话题报告（Agent）", { topic, periodDays, itemCount: result.total });

  const previousArticle = await readDigest(cacheDir, topic);
  let agentContent: string;
  try {
    agentContent = await runDigestAgent(topic, { periodDays, previousArticle });
  } catch (err) {
    logger.error("daily", "话题报告生成失败", { topic, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const header = `# 话题追踪 · ${topic}\n\n> Agent 生成于 ${now}，共整理 ${result.total} 篇相关文章（周期 ${periodDays} 天）\n\n`;
  await mkdir(join(cacheDir, TOPICS_SUBDIR), { recursive: true });
  await writeFile(filePath, header + agentContent, "utf-8");
  logger.info("daily", "话题报告生成完成", { topic, path: filePath });
  return { key: topic, skipped: false, path: filePath };
}

/**
 * 为指定话题生成追踪报告并写入缓存
 */
export async function generateTopicDigest(
  cacheDir: string,
  topic: string,
  force = false
): Promise<{ topic: string; skipped: boolean; path: string }> {
  const result = await generateDigest(cacheDir, topic, force);
  return { topic: result.key, skipped: result.skipped, path: result.path };
}


/**
 * 为所有追踪话题生成报告（供调度器调用）
 */
export async function generateAllTopicDigests(cacheDir: string): Promise<void> {
  const tags = await getSystemTags();
  if (tags.length === 0) {
    logger.debug("topics", "暂无追踪话题，跳过");
    return;
  }

  for (const topic of tags) {
    try {
      await generateTopicDigest(cacheDir, topic, false);
    } catch (err) {
      logger.error("topics", "话题报告生成失败，继续下一话题", {
        topic,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
