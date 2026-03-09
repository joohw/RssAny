// /api/channels、/api/channels/raw、/api/channels/:channelId/feeds

import { readFile, writeFile } from "node:fs/promises";
import type { Hono } from "hono";
import { CHANNELS_CONFIG_PATH } from "../../../config/paths.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../../../core/channel/index.js";
import { getEffectiveItemFields, type ItemTranslationFields } from "../../../types/feedItem.js";
import { queryFeedItems } from "../../../db/index.js";

export function registerChannelsRoutes(app: Hono): void {
  app.get("/api/channels", async (c) => {
    const channels = await getAllChannelConfigs();
    const list = channels.map((ch) => ({
      id: ch.id,
      title: ch.title ?? ch.id,
      description: ch.description ?? "",
    }));
    return c.json(list);
  });

  app.get("/api/channels/raw", async (c) => {
    try {
      const raw = await readFile(CHANNELS_CONFIG_PATH, "utf-8");
      return c.text(raw, 200, { "Content-Type": "application/json; charset=utf-8" });
    } catch {
      return c.text("{}", 200, { "Content-Type": "application/json; charset=utf-8" });
    }
  });

  app.put("/api/channels/raw", async (c) => {
    try {
      const raw = await c.req.text();
      JSON.parse(raw);
      await writeFile(CHANNELS_CONFIG_PATH, raw, "utf-8");
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/channels/:channelId/feeds", async (c) => {
    const channelId = c.req.param("channelId");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const lng = c.req.query("lng") ?? undefined;
    const since = c.req.query("since");
    const until = c.req.query("until");
    const channels = await getAllChannelConfigs();
    const sourceMap = new Map<string, { subId: string; subTitle: string }>();
    for (const ch of channels) {
      const title = ch.title ?? ch.id;
      for (const ref of ch.sourceRefs || []) {
        if (ref) sourceMap.set(ref, { subId: ch.id, subTitle: title });
      }
    }
    let sourceRefs: string[];
    if (channelId === "all" || !channelId) {
      sourceRefs = collectAllSourceRefs(channels);
    } else {
      const ch = channels.find((x) => x.id === channelId);
      sourceRefs = ch?.sourceRefs ?? [];
    }
    const dateOpts = (since || until) ? { since: since ?? undefined, until: until ?? undefined } : undefined;
    const { items: dbItems, hasMore } = await queryFeedItems(sourceRefs, limit, offset, dateOpts);
    const items = dbItems.map((item) => {
      const base = {
        ...item,
        sub_id: sourceMap.get(item.source_url)?.subId ?? "",
        sub_title: sourceMap.get(item.source_url)?.subTitle ?? "",
      };
      if (!lng) return base;
      const view = {
        title: item.title ?? "",
        summary: item.summary ?? "",
        content: item.content ?? "",
        translations: (item as { translations?: Record<string, ItemTranslationFields> }).translations,
      };
      const eff = getEffectiveItemFields(view, lng);
      return { ...base, title: eff.title, summary: eff.summary, content: eff.content };
    });
    return c.json({ items, hasMore });
  });
}
