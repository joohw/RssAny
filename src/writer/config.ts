// 写文件模块配置加载：从 .rssany/config.json 读取，支持环境变量 WRITER_REPO_PATH 覆盖

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { USER_DIR } from "../config/paths.js";
import type { WriterConfig } from "./types.js";

/** 默认不启用，repoPath 占位 */
const DEFAULTS: WriterConfig = {
  enabled: false,
  repoPath: "../AI-Signals",
};

/** 读取 .rssany/config.json 中的 writer 块，WRITER_REPO_PATH 覆盖 repoPath */
export async function loadWriterConfig(): Promise<WriterConfig> {
  let fileWriter: Record<string, unknown> = {};
  try {
    const raw = await readFile(join(USER_DIR, "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.writer && typeof parsed.writer === "object") {
      fileWriter = parsed.writer as Record<string, unknown>;
    }
  } catch {
    // 文件不存在或解析失败时使用默认值
  }
  const repoPath = (process.env.WRITER_REPO_PATH ?? fileWriter["repoPath"] ?? DEFAULTS.repoPath) as string;
  const resolvedPath = repoPath.startsWith("/") ? repoPath : join(process.cwd(), repoPath);
  return {
    enabled: Boolean(fileWriter["enabled"] ?? DEFAULTS.enabled),
    repoPath: resolvedPath,
  };
}
