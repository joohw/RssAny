// 沙盒内只读文本：用于 Web 打开 .md（路径与 project-dirs、sandbox 工具一致）

import { readFile, stat } from "node:fs/promises";
import type { Hono } from "hono";
import { resolveSandboxPath } from "../../../config/paths.js";

const MAX_BYTES = 2_000_000;

function isMdFile(pathRel: string): boolean {
  const seg = pathRel.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  return seg.toLowerCase().endsWith(".md");
}

export function registerSandboxFileRoutes(app: Hono): void {
  app.get("/api/sandbox-file", async (c) => {
    const raw = (c.req.query("rel") ?? "").trim();
    if (!raw) return c.json({ error: "rel 必填" }, 400);
    if (!isMdFile(raw)) return c.json({ error: "仅支持 .md 文件" }, 400);

    const resolved = resolveSandboxPath(raw.replace(/\\/g, "/").replace(/\/+/g, "/").trim() || ".");
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);

    try {
      const st = await stat(resolved.absolute);
      if (!st.isFile()) return c.json({ error: "不是文件" }, 400);
      if (st.size > MAX_BYTES) return c.json({ error: "文件过大（>2MB）" }, 400);
      const content = await readFile(resolved.absolute, "utf-8");
      return c.json({ rel: raw, content });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT")) return c.json({ error: "文件不存在" }, 404);
      return c.json({ error: msg }, 500);
    }
  });
}
