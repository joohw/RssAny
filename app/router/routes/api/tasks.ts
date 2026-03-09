// 任务 API：POST /api/tasks 提交，GET /api/tasks/:id 轮询。执行走 scheduler 统一调度，避免手动与定时冲突

import type { Hono } from "hono";
import * as taskStore from "../../../tasks/index.js";
import * as scheduler from "../../../scheduler/index.js";
import { CACHE_DIR } from "../../../config/paths.js";
import { generateDigest } from "../../../topics/index.js";
import { logger } from "../../../core/logger/index.js";

const TOPICS_GROUP = "topics";

export function registerTasksRoutes(app: Hono): void {
  app.get("/api/tasks/:id", (c) => {
    const id = c.req.param("id") ?? "";
    const task = taskStore.getTask(id);
    if (!task) return c.json({ error: "任务不存在" }, 404);
    return c.json(task);
  });

  app.post("/api/tasks", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { type?: string; topicKey?: string; force?: boolean };
      const type = body.type ?? "";
      if (type === "topic-generate") {
        const topicKey = typeof body.topicKey === "string" ? body.topicKey.trim() : "";
        if (!topicKey) return c.json({ error: "topicKey 不能为空" }, 400);
        const force = body.force ?? true;
        const taskId = taskStore.createTask();
        scheduler.enqueueWithResult(TOPICS_GROUP, taskId, async () => {
          taskStore.setTaskRunning(taskId);
          try {
            const result = await generateDigest(CACHE_DIR, topicKey, force);
            taskStore.setTaskDone(taskId, result);
            return result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("topics", "话题生成失败", { taskId, topicKey, err: msg });
            taskStore.setTaskError(taskId, msg);
            throw err;
          }
        }).catch(() => {});
        return c.json({ taskId });
      }
      return c.json({ error: `未知任务类型: ${type}` }, 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
