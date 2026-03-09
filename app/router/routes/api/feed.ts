// /api/feed、/api/events

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { onFeedUpdated } from "../../../core/events/index.js";
import { getAllChannelConfigs, collectAllSourceRefs } from "../../../core/channel/index.js";
import { getEffectiveItemFields, type ItemTranslationFields } from "../../../types/feedItem.js";
import { queryFeedItems } from "../../../db/index.js";

export function registerFeedRoutes(app: Hono): void {
  app.get("/api/feed", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const channelFilter = c.req.query("channel") ?? c.req.query("sub") ?? undefined;
    const lng = c.req.query("lng") ?? undefined;
    const since = c.req.query("since");
    const until = c.req.query("until");
    const channels = await getAllChannelConfigs();
    const channelsMeta = channels.map((ch) => ({
      id: ch.id,
      title: ch.title ?? ch.id,
      description: ch.description ?? "",
    }));
    let sourceRefs: string[];
    if (channelFilter && channelFilter !== "all") {
      const ch = channels.find((x) => x.id === channelFilter);
      sourceRefs = ch?.sourceRefs ?? [];
    } else {
      sourceRefs = collectAllSourceRefs(channels);
    }
    const sourceMap = new Map<string, { subId: string; subTitle: string }>();
    for (const ch of channels) {
      const title = ch.title ?? ch.id;
      for (const ref of ch.sourceRefs || []) {
        if (ref) sourceMap.set(ref, { subId: ch.id, subTitle: title });
      }
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
    return c.json({ channels: channelsMeta, items, hasMore });
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });
      const off = onFeedUpdated((e) => {
        stream.writeSSE({ data: JSON.stringify({ type: "feed:updated", sourceUrl: e.sourceUrl, newCount: e.newCount }) }).catch(() => {});
      });
      const heartbeat = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 25000);
      stream.onAbort(() => {
        off();
        clearInterval(heartbeat);
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });
}
