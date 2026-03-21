// 定时 Agent 任务：/api/agent-tasks（与 POST /api/tasks 异步队列区分）

import type { Hono } from "hono";
import { getAgentTasks, saveAgentTasks } from "../../../db/index.js";
import { TOPIC_TASK_BASE_DIR } from "../../../config/paths.js";
import { readDigest, listDigestDates, generateDigest } from "../../../topics/index.js";

export function registerAgentTasksRoutes(app: Hono): void {
  app.get("/api/agent-tasks", async (c) => {
    const tasks = await getAgentTasks();
    const withReports = await Promise.all(
      tasks.map(async (t) => {
        const dates = await listDigestDates(TOPIC_TASK_BASE_DIR, t.title);
        return {
          title: t.title,
          description: t.description ?? "",
          prompt: t.prompt ?? "",
          refresh: t.refresh ?? 1,
          reportCount: dates.length,
        };
      }),
    );
    return c.json({ tasks: withReports });
  });

  app.put("/api/agent-tasks", async (c) => {
    try {
      const body = await c.req.json<{
        tasks?: Array<{ title: string; prompt?: string; description?: string; refresh?: number }>;
      }>();
      const list = Array.isArray(body?.tasks) ? body.tasks : [];
      const tasks = list
        .filter((t) => t && typeof t.title === "string" && t.title.trim())
        .map((t) => ({
          title: t.title.trim(),
          prompt: typeof t.prompt === "string" ? t.prompt : "",
          description: typeof t.description === "string" ? t.description : "",
          refresh: typeof t.refresh === "number" && t.refresh >= 1 ? Math.floor(t.refresh) : 1,
        }));
      await saveAgentTasks(tasks);
      const withReports = await Promise.all(
        tasks.map(async (t) => {
          const dates = await listDigestDates(TOPIC_TASK_BASE_DIR, t.title);
          return {
            title: t.title,
            description: t.description ?? "",
            prompt: t.prompt ?? "",
            refresh: t.refresh ?? 1,
            reportCount: dates.length,
          };
        }),
      );
      return c.json({
        ok: true,
        tasks: withReports,
      });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/agent-tasks/:key/dates", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const dates = await listDigestDates(TOPIC_TASK_BASE_DIR, key);
    const latest = dates[0] ?? null;
    return c.json({ key, dates, latest });
  });

  app.get("/api/agent-tasks/:key", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const date = c.req.query("date");
    const result = await readDigest(TOPIC_TASK_BASE_DIR, key, date);
    if (result === null) {
      return c.json({ key, content: null, date: null, exists: false });
    }
    return c.json({ key, content: result.content, date: result.date, exists: true });
  });

  app.post("/api/agent-tasks/:key/generate", async (c) => {
    const key = decodeURIComponent(c.req.param("key") ?? "").trim();
    if (!key) return c.json({ error: "key 参数缺失" }, 400);
    const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
    try {
      const result = await generateDigest(TOPIC_TASK_BASE_DIR, key, body?.force ?? true);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
