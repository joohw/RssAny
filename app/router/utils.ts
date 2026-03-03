// 路由层共享工具函数

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const STATICS_DIR = join(process.cwd(), "statics");

/** 从路径提取 URL（与 /rss/* 一致） */
export function parseUrlFromPath(path: string, prefix: string): string | null {
  const raw = path.slice(prefix.length) || "";
  const decoded = decodeURIComponent(raw.startsWith("/") ? raw.slice(1) : raw);
  if (!decoded) return null;
  return decoded.startsWith("http") ? decoded : `https://${decoded}`;
}

/** 读取静态 HTML（statics/ 目录，用于 401/404 错误页） */
export async function readStaticHtml(name: string, fallback: string): Promise<string> {
  try {
    return await readFile(join(STATICS_DIR, `${name}.html`), "utf-8");
  } catch {
    return fallback;
  }
}

/** HTML 转义，用于注入到页面中的不可信内容 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
