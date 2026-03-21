// 列出 .rssany/sandbox 内目录（与 Agent sandbox 工具一致，用于 Web 端「文件夹」页）
// 带 q 时对 path 下递归搜索：匹配文件名或相对沙盒根的完整路径（子串，不区分大小写）

import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { resolveSandboxPath, SANDBOX_DIR } from "../../../config/paths.js";

const MAX_SEARCH_MATCHES = 800;
/** 防止 cache/browser_data 等极大目录或环拖死事件循环 */
const SEARCH_WALL_MS = 45_000;

type ListEntry = { name: string; type: "directory" | "file" };
type SearchEntry = ListEntry & { relPath: string };

async function collectRecursiveMatches(
  absDir: string,
  relPrefix: string,
  needle: string,
  entries: SearchEntry[],
  limit: number,
  visited: Set<string>
): Promise<boolean> {
  let dirReal: string;
  try {
    dirReal = await realpath(absDir);
  } catch {
    return false;
  }
  if (visited.has(dirReal)) {
    return false;
  }
  visited.add(dirReal);

  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    return false;
  }
  names.sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const relPath = relPrefix ? `${relPrefix}/${name}` : name;
    const absChild = join(absDir, name);
    let st;
    try {
      st = await stat(absChild);
    } catch {
      continue;
    }
    const nameL = name.toLowerCase();
    const pathL = relPath.toLowerCase();
    const isDir = st.isDirectory();
    if (nameL.includes(needle) || pathL.includes(needle)) {
      entries.push({ name, type: isDir ? "directory" : "file", relPath });
      if (entries.length >= limit) {
        return true;
      }
    }
    if (isDir) {
      const sub = await collectRecursiveMatches(absChild, relPath, needle, entries, limit, visited);
      if (sub) {
        return true;
      }
    }
  }
  return false;
}

export function registerProjectDirsRoutes(app: Hono): void {
  app.get("/api/project-dirs", async (c) => {
    const raw = (c.req.query("rel") ?? "").trim();
    const relNorm = raw.replace(/\\/g, "/").replace(/\/+/g, "/").trim() || ".";
    const resolved = resolveSandboxPath(relNorm);
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, 400);
    }
    const abs = resolved.absolute;
    const qRaw = (c.req.query("q") ?? "").trim();
    const needle = qRaw.toLowerCase();
    try {
      const st = await stat(abs);
      if (!st.isDirectory()) {
        return c.json({ error: "不是目录" }, 400);
      }
      const relDisplay = relNorm === "." ? "" : relNorm;
      const relPrefixForWalk = relDisplay;

      if (needle) {
        const entries: SearchEntry[] = [];
        const visited = new Set<string>();
        let truncated = false;
        let timedOut = false;
        try {
          truncated = await Promise.race([
            collectRecursiveMatches(abs, relPrefixForWalk, needle, entries, MAX_SEARCH_MATCHES, visited),
            new Promise<boolean>((_, reject) => {
              setTimeout(() => reject(new Error("search_timeout")), SEARCH_WALL_MS);
            }),
          ]);
        } catch (e) {
          if (e instanceof Error && e.message === "search_timeout") {
            timedOut = true;
            truncated = true;
          } else {
            throw e;
          }
        }
        return c.json({
          path: relDisplay || ".",
          sandboxRoot: SANDBOX_DIR,
          mode: "search" as const,
          q: qRaw,
          truncated,
          timedOut,
          matchLimit: MAX_SEARCH_MATCHES,
          entries,
        });
      }

      const names = await readdir(abs);
      const entries: ListEntry[] = [];
      for (const name of names.sort((a, b) => a.localeCompare(b))) {
        const p = join(abs, name);
        try {
          const s = await stat(p);
          entries.push({
            name,
            type: s.isDirectory() ? "directory" : "file",
          });
        } catch {
          /* 忽略无法 stat 的项 */
        }
      }
      return c.json({
        path: relDisplay || ".",
        sandboxRoot: SANDBOX_DIR,
        entries,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT")) return c.json({ error: "目录不存在" }, 404);
      return c.json({ error: msg }, 500);
    }
  });
}
