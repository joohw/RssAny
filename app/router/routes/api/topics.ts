// /api/tags — 系统标签（pipeline tagger）；原 /api/topics 任务接口已迁至 /api/agent-tasks

import type { Hono } from "hono";
import {
  getSuggestedTags,
  getSystemTags,
  getSystemTagStats,
  saveSystemTagsToFile,
  removeTagFromAllItems,
} from "../../../db/index.js";

export function registerTopicsRoutes(app: Hono): void {
  /** 系统标签：来自 .rssany/tags.json，供 pipeline tagger 使用 */
  app.get("/api/tags", async (c) => {
    const [tags, stats, suggested] = await Promise.all([
      getSystemTags(),
      getSystemTagStats(),
      getSuggestedTags(),
    ]);
    return c.json({
      tags,
      stats: stats.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
      suggestedTags: suggested.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
    });
  });

  app.put("/api/tags", async (c) => {
    try {
      const body = await c.req.json<{ tags?: string[] }>();
      const list = Array.isArray(body?.tags) ? body.tags : [];
      await saveSystemTagsToFile(list);
      const [tags, stats, suggested] = await Promise.all([
        getSystemTags(),
        getSystemTagStats(),
        getSuggestedTags(),
      ]);
      return c.json({
        ok: true,
        tags,
        stats: stats.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
        suggestedTags: suggested.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
      });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** 从所有条目的 tags 中移除指定标签 */
  app.post("/api/tags/remove-from-items", async (c) => {
    try {
      const body = await c.req.json<{ tag?: string }>();
      const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
      if (!tag) return c.json({ ok: false, message: "tag 参数缺失" }, 400);
      const count = await removeTagFromAllItems(tag);
      const [tags, stats, suggested] = await Promise.all([
        getSystemTags(),
        getSystemTagStats(),
        getSuggestedTags(),
      ]);
      return c.json({
        ok: true,
        removedCount: count,
        tags,
        stats: stats.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
        suggestedTags: suggested.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
      });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
}
