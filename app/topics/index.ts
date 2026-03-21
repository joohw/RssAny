// 定时 Agent 任务报告：沙盒内 task/[任务标题]/yyyy-mm-dd.md（即 .rssany/sandbox/task/…）

import { mkdir, stat, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runDigestAgent } from "./agent.js";
import { logger } from "../core/logger/index.js";
import { getAgentTasks } from "../db/index.js";
import { queryItems } from "../db/index.js";

const TASK_REPORTS_DIR = "task";

export interface DigestGenerateResult {
  key: string;
  skipped: boolean;
  path: string;
  reason?: "exists" | "no-items";
  message?: string;
}


/** 话题名转安全的文件名（保留中文等，仅替换路径非法字符） */
function topicToFilename(topic: string): string {
  return topic.replace(/[/\\:*?"<>|]/g, "_").trim() || "default";
}


function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}


/** 存储路径（相对沙盒根）：task/[任务标题]/yyyy-mm-dd.md */
export function digestFilePath(baseDir: string, key: string, date?: string): string {
  const d = date ?? todayDate();
  return join(baseDir, TASK_REPORTS_DIR, topicToFilename(key), `${d}.md`);
}


/** 当日话题报告文件路径（沙盒内） */
export function topicFilePath(baseDir: string, topic: string): string {
  return digestFilePath(baseDir, topic);
}


/** 检查指定 key 的报告是否已生成（话题检查当日，日期检查该日） */
export async function digestExists(baseDir: string, key: string): Promise<boolean> {
  return stat(digestFilePath(baseDir, key)).then(() => true).catch(() => false);
}


/** 列出该话题已有报告的日期（yyyy-mm-dd），按日期降序 */
export async function listDigestDates(baseDir: string, key: string): Promise<string[]> {
  try {
    const dir = join(baseDir, TASK_REPORTS_DIR, topicToFilename(key));
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
  baseDir: string,
  key: string,
  date?: string
): Promise<{ content: string; date: string } | null> {
  try {
    const dir = join(baseDir, TASK_REPORTS_DIR, topicToFilename(key));
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
export async function readTopicDigest(baseDir: string, topic: string): Promise<string | null> {
  const r = await readDigest(baseDir, topic);
  return r?.content ?? null;
}


/** 检查指定话题的报告是否已生成 */
export async function topicExists(baseDir: string, topic: string): Promise<boolean> {
  return digestExists(baseDir, topic);
}


/** 列出已有报告的任务名列表（task 子目录名） */
export async function listDigestTopics(baseDir: string): Promise<string[]> {
  const taskRoot = join(baseDir, TASK_REPORTS_DIR);
  try {
    const subdirs = await readdir(taskRoot);
    return subdirs.sort();
  } catch {
    return [];
  }
}


/**
 * 生成报告：Agent 按时间窗拉取候选；topics 的 tags 仅作提示语参考，不参与预检过滤
 */
export async function generateDigest(
  baseDir: string,
  key: string,
  force = false
): Promise<DigestGenerateResult> {
  const filePath = digestFilePath(baseDir, key);
  if (!force && await digestExists(baseDir, key)) {
    logger.debug("topics", "报告已存在，跳过生成", { key });
    return {
      key,
      skipped: true,
      path: filePath,
      reason: "exists",
      message: "当日报告已存在，已跳过生成",
    };
  }
  return doGenerateTopic(baseDir, key, filePath);
}

async function doGenerateTopic(
  baseDir: string,
  topicKey: string,
  filePath: string
): Promise<DigestGenerateResult> {
  const tasks = await getAgentTasks();
  const taskConfig = tasks.find((t) => t.title === topicKey);
  const periodDays = Math.max(1, taskConfig?.refresh ?? 1);
  const prompt = taskConfig?.prompt ?? "";

  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const until = new Date();
  until.setDate(until.getDate() + 1);

  const result = await queryItems({
    since,
    until,
    limit: 1,
    offset: 0,
  });
  logger.info("topics", "开始生成 Agent 任务报告", {
    topic: topicKey,
    periodDays,
    windowItemCount: result.total,
  });

  const prevDigest = await readDigest(baseDir, topicKey);
  const previousArticle = prevDigest?.content ?? null;
  let agentContent: string;
  try {
    agentContent = await runDigestAgent(topicKey, {
      periodDays,
      previousArticle,
      prompt,
      windowItemCount: result.total,
    });
  } catch (err) {
    logger.error("topics", "话题报告生成失败", { topic: topicKey, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const preflightSummary =
    result.total > 0
      ? `，该周期内库中约 ${result.total} 条条目`
      : "，该周期内库中暂无可检索条目";
  const header = `# 任务报告 · ${topicKey}\n\n> Agent 生成于 ${now}，周期 ${periodDays} 天${preflightSummary}\n\n`;
  await mkdir(join(baseDir, TASK_REPORTS_DIR, topicToFilename(topicKey)), { recursive: true });
  await writeFile(filePath, header + agentContent, "utf-8");
  logger.info("topics", "话题报告生成完成", { topic: topicKey, path: filePath });
  return { key: topicKey, skipped: false, path: filePath };
}

/**
 * 为指定任务生成报告并写入沙盒 task/
 */
export async function generateTopicDigest(
  baseDir: string,
  topic: string,
  force = false
): Promise<{ topic: string; skipped: boolean; path: string; reason?: "exists" | "no-items"; message?: string }> {
  const result = await generateDigest(baseDir, topic, force);
  return {
    topic: result.key,
    skipped: result.skipped,
    path: result.path,
    reason: result.reason,
    message: result.message,
  };
}


/**
 * 为所有追踪话题生成报告（供调度器调用）
 */
export async function generateAllTopicDigests(baseDir: string): Promise<void> {
  const tasks = await getAgentTasks();
  if (tasks.length === 0) {
    logger.debug("topics", "暂无定时任务，跳过");
    return;
  }

  for (const task of tasks) {
    try {
      await generateTopicDigest(baseDir, task.title, false);
    } catch (err) {
      logger.error("topics", "任务报告生成失败，继续下一任务", {
        topic: task.title,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
