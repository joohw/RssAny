// /api/deliver（投递配置与测试）

import type { Hono } from "hono";
import { loadDeliverConfig, saveDeliverConfig } from "../../../deliver/config.js";
import { deliverItemToUrl } from "../../../deliver/index.js";
import type { FeedItem } from "../../../types/feedItem.js";

/** 测试用示例条目 */
const SAMPLE_ITEM: FeedItem = {
  guid: "test-deliver-" + Date.now(),
  title: "测试投递条目",
  link: "https://example.com/test",
  pubDate: new Date(),
  summary: "这是一条用于测试投递的示例条目",
  sourceRef: "deliver-test",
};

export function registerDeliverRoutes(app: Hono): void {
  app.get("/api/deliver", async (c) => {
    const config = await loadDeliverConfig();
    return c.json({ enabled: config.enabled, url: config.url ?? "" });
  });

  app.put("/api/deliver", async (c) => {
    try {
      const body = await c.req.json<{ enabled?: boolean; url?: string }>();
      const e: unknown = body?.enabled;
      const enabled = e === true || e === 1;
      const url = typeof body?.url === "string" ? body.url.trim() : "";
      await saveDeliverConfig({ enabled, url: url || undefined });
      return c.json({ ok: true, enabled, url: url || undefined });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** 测试端点：POST 到配置的 URL，不写数据库 */
  app.post("/api/deliver/test", async (c) => {
    try {
      let body: { url?: string; item?: unknown } = {};
      try {
        body = await c.req.json<{ url?: string; item?: unknown }>();
      } catch {
        /* 空 body 使用默认 */
      }
      const config = await loadDeliverConfig();
      const targetUrl = typeof body.url === "string" ? body.url.trim() : config.url?.trim();
      if (!targetUrl) {
        return c.json({ ok: false, message: "未配置投递 URL，请在设置中填写或请求体传入 url" }, 400);
      }

      let item: FeedItem = { ...SAMPLE_ITEM, guid: "test-deliver-" + Date.now() };
      if (body.item && typeof body.item === "object") {
        const raw = body.item as Record<string, unknown>;
        const link = typeof raw.link === "string" ? raw.link : SAMPLE_ITEM.link;
        const pd = raw.pubDate;
        const pubDate =
          pd instanceof Date ? pd : typeof pd === "string" ? new Date(pd) : new Date();
        item = {
          guid: typeof raw.guid === "string" ? raw.guid : `test-${Date.now()}`,
          title: typeof raw.title === "string" ? raw.title : SAMPLE_ITEM.title,
          link,
          pubDate: Number.isNaN(pubDate.getTime()) ? new Date() : pubDate,
          summary: typeof raw.summary === "string" ? raw.summary : SAMPLE_ITEM.summary,
          content: typeof raw.content === "string" ? raw.content : undefined,
          sourceRef: "deliver-test",
        };
      }

      const result = await deliverItemToUrl(item, targetUrl);
      if (result.ok) {
        return c.json({ ok: true, message: "投递成功" });
      }
      return c.json(
        { ok: false, message: result.message ?? "投递失败", status: result.status },
        400
      );
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
