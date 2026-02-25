// 路径配置：集中管理所有运行时路径，区分项目文件与用户数据

import { mkdir, rename, access } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger/index.js";


/** 用户数据根目录：.rssany/（不纳入版本管理，存放所有运行时用户数据） */
export const USER_DIR = join(process.cwd(), ".rssany");


/** SQLite 数据库目录：.rssany/data/ */
export const DATA_DIR = join(USER_DIR, "data");


/** 站点配置文件：.rssany/sites.json */
export const SITES_CONFIG_PATH = join(USER_DIR, "sites.json");


/** 订阅配置文件：.rssany/subscriptions.json */
export const SUBSCRIPTIONS_CONFIG_PATH = join(USER_DIR, "subscriptions.json");


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
  await migrateFile(join(process.cwd(), "subscriptions.json"), SUBSCRIPTIONS_CONFIG_PATH);
  await migrateFile(join(process.cwd(), "data", "rssany.db"), join(DATA_DIR, "rssany.db"));
}
