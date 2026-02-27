// Signal 配置加载：从 .rssany/config.json 读取，支持环境变量 SIGNAL_REPO_PATH 兜底

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { USER_DIR } from "../config/paths.js";
import type { SignalConfig } from "./types.js";


/** 默认不启用，repoPath 占位 */
const DEFAULTS: SignalConfig = {
  enabled: false,
  repoPath: "../AI-Signals",
};


/** 读取 .rssany/config.json 中的 signal 块，SIGNAL_REPO_PATH 覆盖 repoPath */
export async function loadSignalConfig(): Promise<SignalConfig> {
  let fileSignal: Record<string, unknown> = {};
  try {
    const raw = await readFile(join(USER_DIR, "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.signal && typeof parsed.signal === "object") {
      fileSignal = parsed.signal as Record<string, unknown>;
    }
  } catch {
    // 文件不存在或解析失败时使用默认值
  }
  const repoPath = (process.env.SIGNAL_REPO_PATH ?? fileSignal["repoPath"] ?? DEFAULTS.repoPath) as string;
  const resolvedPath = repoPath.startsWith("/") ? repoPath : join(process.cwd(), repoPath);
  return {
    enabled: Boolean(fileSignal["enabled"] ?? DEFAULTS.enabled),
    repoPath: resolvedPath,
  };
}
