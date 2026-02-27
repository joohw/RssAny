// 路径配置：集中管理所有运行时路径，区分项目文件与用户数据

import { mkdir, rename, access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger/index.js";


/** 用户数据根目录：.rssany/（不纳入版本管理，存放所有运行时用户数据） */
export const USER_DIR = join(process.cwd(), ".rssany");


/** SQLite 数据库目录：.rssany/data/ */
export const DATA_DIR = join(USER_DIR, "data");


/** 站点配置文件：.rssany/sites.json */
export const SITES_CONFIG_PATH = join(USER_DIR, "sites.json");


/** 爬虫配置：.rssany/sources.json（扁平信源列表，供 scheduler 使用） */
export const SOURCES_CONFIG_PATH = join(USER_DIR, "sources.json");


/** 首页信息流频道配置：.rssany/channels.json（channel → sourceRefs，供 Feed API 使用） */
export const CHANNELS_CONFIG_PATH = join(USER_DIR, "channels.json");


/** @deprecated 仅用于迁移：若存在 .rssany/subscriptions.json 且无 sources.json 则迁移为 sources.json */
const LEGACY_SUBSCRIPTIONS_PATH = join(USER_DIR, "subscriptions.json");


/** 内置插件目录：plugins/（项目文件，纳入版本管理） */
export const BUILTIN_PLUGINS_DIR = join(process.cwd(), "plugins");


/** 用户自定义插件目录：.rssany/plugins/（用户数据，不纳入版本管理） */
export const USER_PLUGINS_DIR = join(USER_DIR, "plugins");


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
  await mkdir(USER_PLUGINS_DIR, { recursive: true });
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
}
