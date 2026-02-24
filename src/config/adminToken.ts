// Admin token：首次启动时随机生成并持久化到 .rssany/admin-token.txt，重启不变

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { USER_DIR } from "./paths.js";


const TOKEN_PATH = join(USER_DIR, "admin-token.txt");
let cachedToken: string | null = null;


/** 获取 admin token（首次调用时自动生成并保存，后续从缓存/文件读取） */
export async function getAdminToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    const existing = (await readFile(TOKEN_PATH, "utf-8")).trim();
    if (existing.length >= 16) {
      cachedToken = existing;
      return cachedToken;
    }
  } catch { /* 文件不存在，继续生成 */ }
  const token = randomBytes(20).toString("hex");
  await writeFile(TOKEN_PATH, token, "utf-8");
  cachedToken = token;
  return token;
}
