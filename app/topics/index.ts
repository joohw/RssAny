// 话题报告生成：存储为 articles/[topicName]/yyyy-mm-dd.md

import { mkdir, stat, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runDigestAgent } from "./agent.js";
import { logger } from "../core/logger/index.js";
import { getTopics } from "../db/index.js";
import { queryItems } from "../db/index.js";


const ARTICLES_DIR = "articles";


/** 话题名转安全的文件名（保留中文等，仅替换路径非法字符） */
function topicToFilename(topic: string): string {
  return topic.replace(/[/\\:*?"<>|]/g, "_").trim() || "default";
}


function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}


/** 存储路径：articles/[topicName]/yyyy-mm-dd.md */
export function digestFilePath(cacheDir: string, key: string, date?: string): string {
  const d = date ?? todayDate();
  return join(cacheDir, ARTICLES_DIR, topicToFilename(key), `${d}.md`);
}


/** 话题报告缓存文件路径（当日） */
export function topicFilePath(cacheDir: string, topic: string): string {
  return digestFilePath(cacheDir, topic);
}


/** 检查指定 key 的报告是否已生成（话题检查当日，日期检查该日） */
export async function digestExists(cacheDir: string, key: string): Promise<boolean> {
  return stat(digestFilePath(cacheDir, key)).then(() => true).catch(() => false);
}


/** 列出该话题已有报告的日期（yyyy-mm-dd），按日期降序 */
export async function listDigestDates(cacheDir: string, key: string): Promise<string[]> {
  try {
    const dir = join(cacheDir, ARTICLES_DIR, topicToFilename(key));
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

/** 读取报告内容，不存在返回 null。date 不传则读最新日期的文件。返回 { content, date } 便于前端展示 */
export async function readDigest(
  cacheDir: string,
  key: string,
  date?: string
): Promise<{ content: string; date: string } | null> {
  try {
    const dir = join(cacheDir, ARTICLES_DIR, topicToFilename(key));
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) return null;
    const target = date && mdFiles.includes(`${date}.md`) ? `${date}.md` : mdFiles[0];
    const content = await readFile(join(dir, target), "utf-8");
    const resolvedDate = target.slice(0, -3);
    return { content, date: resolvedDate };
  } catch {
    return null;
  }
}


/** 读取指定话题的报告内容，不存在返回 null */
export async function readTopicDigest(cacheDir: string, topic: string): Promise<string | null> {
  const r = await readDigest(cacheDir, topic);
  return r?.content ?? null;
}


/** 检查指定话题的报告是否已生成 */
export async function topicExists(cacheDir: string, topic: string): Promise<boolean> {
  return digestExists(cacheDir, topic);
}


/** 列出已有报告的话题名列表 */
export async function listDigestTopics(cacheDir: string): Promise<string[]> {
  const baseDir = join(cacheDir, ARTICLES_DIR);
  try {
    const subdirs = await readdir(baseDir);
    return subdirs.sort();
  } catch {
    return [];
  }
}


/**
 * 生成报告：统一话题逻辑，tags 为空时取全部文章
 */
export async function generateDigest(
  cacheDir: string,
  key: string,
  force = false
): Promise<{ key: string; skipped: boolean; path: string }> {
  const filePath = digestFilePath(cacheDir, key);
  if (!force && await digestExists(cacheDir, key)) {
    logger.debug("topics", "报告已存在，跳过生成", { key });
    return { key, skipped: true, path: filePath };
  }
  return doGenerateTopic(cacheDir, key, filePath);
}

async function doGenerateTopic(
  cacheDir: string,
  topicKey: string,
  filePath: string
): Promise<{ key: string; skipped: boolean; path: string }> {
  const topics = await getTopics();
  const topicConfig = topics.find((t) => t.title === topicKey);
  const periodDays = Math.max(1, topicConfig?.refresh ?? 1);
  const tags = topicConfig?.tags;
  const tagsForQuery = Array.isArray(tags) && tags.length > 0 ? tags : (topicConfig ? undefined : [topicKey]);
  const searchTagsForPrompt = tagsForQuery ?? (topicConfig ? [] : [topicKey]);
  const prompt = topicConfig?.prompt ?? "";

  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const until = new Date();
  until.setDate(until.getDate() + 1);

  const result = await queryItems({
    tags: tagsForQuery,
    since,
    until,
    limit: 1,
    offset: 0,
  });
  if (result.items.length === 0 && result.total === 0) {
    logger.info("topics", "该话题近期无文章，跳过生成", { topic: topicKey, periodDays });
    return { key: topicKey, skipped: true, path: filePath };
  }
  logger.info("topics", "开始生成话题报告（Agent）", { topic: topicKey, periodDays, itemCount: result.total });

  const prevDigest = await readDigest(cacheDir, topicKey);
  const previousArticle = prevDigest?.content ?? null;
  let agentContent: string;
  try {
    agentContent = await runDigestAgent(topicKey, {
      periodDays,
      previousArticle,
      searchTags: searchTagsForPrompt,
      prompt,
    });
  } catch (err) {
    logger.error("topics", "话题报告生成失败", { topic: topicKey, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const header = `# 话题追踪 · ${topicKey}\n\n> Agent 生成于 ${now}，共整理 ${result.total} 篇相关文章（周期 ${periodDays} 天）\n\n`;
  await mkdir(join(cacheDir, ARTICLES_DIR, topicToFilename(topicKey)), { recursive: true });
  await writeFile(filePath, header + agentContent, "utf-8");
  logger.info("topics", "话题报告生成完成", { topic: topicKey, path: filePath });
  return { key: topicKey, skipped: false, path: filePath };
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
  const topics = await getTopics();
  if (topics.length === 0) {
    logger.debug("topics", "暂无追踪话题，跳过");
    return;
  }

  for (const topic of topics) {
    try {
      await generateTopicDigest(cacheDir, topic.title, false);
    } catch (err) {
      logger.error("topics", "话题报告生成失败，继续下一话题", {
        topic: topic.title,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
