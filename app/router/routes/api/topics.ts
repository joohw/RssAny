// /api/topics、/api/tags（deprecated）、/api/topics/:key

import type { Hono } from "hono";
import {
  saveTopics,
  getTopics,
  getTopicStats,
  getSuggestedTags,
  getSystemTags,
  getSystemTagStats,
  saveSystemTagsToFile,
  removeTagFromAllItems,
} from "../../../db/index.js";
import { CACHE_DIR } from "../../../config/paths.js";
import { readDigest, listDigestDates, generateDigest } from "../../../topics/index.js";

export function registerTopicsRoutes(app: Hono): void {
  app.get("/api/topics", async (c) => {
    const [topics, stats, suggested] = await Promise.all([getTopics(), getTopicStats(), getSuggestedTags()]);
    return c.json({
      topics,
      stats: stats.map((s) => ({
        title: s.title,
        tags: s.tags,
        prompt: s.prompt,
        description: s.description,
        refresh: s.refresh ?? 1,
        count: s.count,
        hotness: s.hotness,
      })),
      suggestedTags: suggested.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
    });
  });

  app.put("/api/topics", async (c) => {
    try {
      const body = await c.req.json<{ topics?: Array<{ title: string; tags?: string[]; prompt?: string; description?: string; refresh?: number }> }>();
      const list = Array.isArray(body?.topics) ? body.topics : [];
      const topics = list
        .filter((t) => t && typeof t.title === "string" && t.title.trim())
        .map((t) => ({
          title: t.title.trim(),
          tags: Array.isArray(t.tags) && t.tags.length > 0 ? t.tags : [t.title.trim()],
          prompt: typeof t.prompt === "string" ? t.prompt : "",
          description: typeof t.description === "string" ? t.description : "",
          refresh: typeof t.refresh === "number" && t.refresh >= 1 ? Math.floor(t.refresh) : 1,
        }));
      await saveTopics(topics);
      const [stats, suggested] = await Promise.all([getTopicStats(), getSuggestedTags()]);
      return c.json({
        ok: true,
        topics,
        stats: stats.map((s) => ({
          title: s.title,
          tags: s.tags,
          prompt: s.prompt,
          description: s.description,
          refresh: s.refresh ?? 1,
          count: s.count,
          hotness: s.hotness,
        })),
        suggestedTags: suggested.map((s) => ({ name: s.name, count: s.count, hotness: s.hotness })),
      });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

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

  app.get("/api/topics/:key/dates", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const dates = await listDigestDates(CACHE_DIR, key);
    const latest = dates[0] ?? null;
    return c.json({ key, dates, latest });
  });

  app.get("/api/topics/:key", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const date = c.req.query("date");
    const result = await readDigest(CACHE_DIR, key, date);
    if (result === null) {
      return c.json({ key, content: null, date: null, exists: false });
    }
    return c.json({ key, content: result.content, date: result.date, exists: true });
  });

  app.post("/api/topics/:key/generate", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
    try {
      const result = await generateDigest(CACHE_DIR, key, body?.force ?? true);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
