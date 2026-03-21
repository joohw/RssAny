// 路径配置：集中管理所有运行时路径，区分项目文件与用户数据

import { mkdir, rename, access, readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { logger } from "../core/logger/index.js";


/** 用户数据根目录：.rssany/（不纳入版本管理，存放所有运行时用户数据） */
export const USER_DIR = join(process.cwd(), ".rssany");

/** Agent 文件工具沙箱根目录：.rssany/sandbox/；Agent / MCP 仅通过 sandbox 工具访问此目录 */
export const SANDBOX_DIR = join(USER_DIR, "sandbox");

/** 定时任务报告：父路径为沙盒根，实际文件为 .rssany/sandbox/task/[任务]/yyyy-mm-dd.md */
export const TOPIC_TASK_BASE_DIR = SANDBOX_DIR;

/** 将相对路径解析到沙箱内绝对路径，禁止逃逸到沙箱外；path 为相对 .rssany/sandbox 的路径。 */
export function resolveSandboxPath(path: string): { absolute: string } | { error: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim() || ".";
  const absolute = resolve(SANDBOX_DIR, normalized);
  const rel = relative(SANDBOX_DIR, absolute);
  if (rel.startsWith("..") || resolve(SANDBOX_DIR, rel) !== absolute) {
    return { error: "路径不允许访问沙箱外目录" };
  }
  return { absolute };
}

/** SQLite 数据库目录：.rssany/data/ */
export const DATA_DIR = join(USER_DIR, "data");


/** 缓存目录：.rssany/cache/（fetched、extracted、feeds、domains、browser_data 等子目录）；环境变量 CACHE_DIR 可覆盖 */
export const CACHE_DIR = process.env.CACHE_DIR ?? join(USER_DIR, "cache");


/** 站点配置文件：.rssany/sites.json */
export const SITES_CONFIG_PATH = join(USER_DIR, "sites.json");


/** 爬虫配置：.rssany/sources.json（扁平信源列表，供 scheduler 使用） */
export const SOURCES_CONFIG_PATH = join(USER_DIR, "sources.json");


/** 首页信息流频道配置：.rssany/channels.json（channel → sourceRefs，供 Feed API 使用） */
export const CHANNELS_CONFIG_PATH = join(USER_DIR, "channels.json");


/** 系统标签配置：.rssany/tags.json（供 pipeline tagger 使用） */
export const TAGS_CONFIG_PATH = join(USER_DIR, "tags.json");

/** 定时 Agent 任务：.rssany/tasks.json（title、prompt、description、refresh；无 tags） */
export const TASKS_CONFIG_PATH = join(USER_DIR, "tasks.json");

/** 全局配置：.rssany/config.json（enrich、pipeline 等） */
export const CONFIG_PATH = join(USER_DIR, "config.json");


/** @deprecated 仅用于迁移：若存在 .rssany/subscriptions.json 且无 sources.json 则迁移为 sources.json */
const LEGACY_SUBSCRIPTIONS_PATH = join(USER_DIR, "subscriptions.json");


/** 内置插件目录：plugins/（项目文件，纳入版本管理） */
export const BUILTIN_PLUGINS_DIR = join(process.cwd(), "plugins");


/** 用户自定义插件目录：.rssany/plugins/（用户数据，不纳入版本管理） */
export const USER_PLUGINS_DIR = join(USER_DIR, "plugins");


/** 插件子目录：sources（信源） / enrich（补全）；pipeline 已移至 app/pipeline/ 作为固定流程 */
export const BUILTIN_SOURCES_DIR = join(BUILTIN_PLUGINS_DIR, "sources");
export const USER_SOURCES_DIR = join(USER_PLUGINS_DIR, "sources");
export const BUILTIN_ENRICH_DIR = join(BUILTIN_PLUGINS_DIR, "enrich");
export const USER_ENRICH_DIR = join(USER_PLUGINS_DIR, "enrich");


/** 检查路径是否存在 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}


/** 迁移单个文件：仅在源存在且目标不存在时执行，迁移失败只打警告不中断 */
async function migrateFile(from: string, to: string): Promise<void> {
  if (!(await pathExists(from))) return;
  if (await pathExists(to)) return;
  try {
    await rename(from, to);
    logger.info("config", "配置已迁移", { from, to });
  } catch (err) {
    logger.warn("config", "配置迁移失败", { from, to, err: err instanceof Error ? err.message : String(err) });
  }
}


/** 初始化用户数据目录，自动迁移旧版配置文件到 .rssany/ */
export async function initUserDir(): Promise<void> {
  await mkdir(USER_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(SANDBOX_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(USER_PLUGINS_DIR, { recursive: true });
  await mkdir(USER_SOURCES_DIR, { recursive: true });
  await mkdir(USER_ENRICH_DIR, { recursive: true });
  await migrateFile(join(process.cwd(), "sites.json"), SITES_CONFIG_PATH);
  await migrateFile(join(process.cwd(), "subscriptions.json"), SOURCES_CONFIG_PATH);
  await migrateFile(join(process.cwd(), "data", "rssany.db"), join(DATA_DIR, "rssany.db"));
  if (!(await pathExists(SOURCES_CONFIG_PATH)) && (await pathExists(LEGACY_SUBSCRIPTIONS_PATH))) {
    await migrateFile(LEGACY_SUBSCRIPTIONS_PATH, SOURCES_CONFIG_PATH);
  }
  if (!(await pathExists(CHANNELS_CONFIG_PATH)) && (await pathExists(SOURCES_CONFIG_PATH))) {
    try {
      const raw = await readFile(SOURCES_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const refs: string[] = [];
      if (parsed && typeof parsed === "object") {
        if (Array.isArray((parsed as { sources?: unknown[] }).sources)) {
          for (const s of (parsed as { sources: { ref?: string }[] }).sources) {
            if (s?.ref) refs.push(s.ref);
          }
        } else {
          for (const entry of Object.values(parsed as Record<string, { sources?: Array<{ ref?: string }> }>)) {
            if (entry && Array.isArray(entry.sources)) {
              for (const s of entry.sources) {
                if (s?.ref) refs.push(s.ref);
              }
            }
          }
        }
      }
      const channels: Record<string, { title: string; sourceRefs: string[] }> = {
        all: { title: "全部", sourceRefs: refs },
      };
      await writeFile(CHANNELS_CONFIG_PATH, JSON.stringify(channels, null, 2) + "\n", "utf-8");
      logger.info("config", "已根据 sources.json 生成默认 channels.json");
    } catch (err) {
      logger.warn("config", "生成 channels.json 失败", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // 确保 tasks.json 包含「日报」定时任务
  const DAILY_AGENT_TASK = {
    title: "日报",
    description: "当日行业热度日报",
    prompt: `按当日全部文章生成行业热度日报。执行步骤：1. 调用 get_feeds（since=当日, until=次日, limit=200）获取当日全部文章；2. 根据标题和摘要判断影响力大的新闻（通常 5-8 条）；3. 对每条重要新闻调用 get_feed_detail 获取完整正文（最多 8 次）；4. 基于完整正文输出结构化日报。输出格式：行业热度榜（按热度降序，每条含标题、相关度、关键词、要点、来源）、频道速览（按频道分组列出其余文章）。`,
    refresh: 1,
  };
  try {
    let tasks: Array<{ title: string; prompt?: string; description?: string; refresh?: number }> = [];
    try {
      const raw = await readFile(TASKS_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as {
        tasks?: Array<{ title: string; prompt?: string; description?: string; refresh?: number }>;
      };
      tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    } catch {
      /* 文件不存在或解析失败，使用空列表 */
    }
    if (!tasks.some((t) => t?.title === "日报")) {
      tasks = [DAILY_AGENT_TASK, ...tasks];
      await writeFile(TASKS_CONFIG_PATH, JSON.stringify({ tasks }, null, 2), "utf-8");
      logger.info("config", "已添加日报任务至 tasks.json");
    }
  } catch (err) {
    logger.warn("config", "添加日报任务失败", { err: err instanceof Error ? err.message : String(err) });
  }
}
