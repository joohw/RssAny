// 任务 API：POST /api/tasks 提交，GET /api/tasks/:id 轮询。执行走 scheduler 统一调度，避免手动与定时冲突

import type { Hono } from "hono";
import * as taskStore from "../../../tasks/index.js";
import * as scheduler from "../../../scheduler/index.js";
import { CACHE_DIR, TOPIC_TASK_BASE_DIR } from "../../../config/paths.js";
import { generateDigest } from "../../../topics/index.js";
import { getItems } from "../../../feeder/index.js";
import { SOURCES_GROUP } from "../../../scraper/scheduler/index.js";
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
      const body = (await c.req.json().catch(() => ({}))) as {
        type?: string;
        taskKey?: string;
        topicKey?: string;
        force?: boolean;
        ref?: string;
      };
      const type = body.type ?? "";
      if (type === "topic-generate" || type === "agent-task-generate") {
        const taskKey =
          typeof body.taskKey === "string"
            ? body.taskKey.trim()
            : typeof body.topicKey === "string"
              ? body.topicKey.trim()
              : "";
        if (!taskKey) return c.json({ error: "taskKey 不能为空" }, 400);
        const force = body.force ?? true;
        const taskId = taskStore.createTask();
        scheduler.schedule(TOPICS_GROUP, taskId, async () => {
          taskStore.setTaskRunning(taskId);
          try {
            const result = await generateDigest(TOPIC_TASK_BASE_DIR, taskKey, force);
            taskStore.setTaskDone(taskId, result);
            return result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("topics", "Agent 任务生成失败", { taskId, taskKey, err: msg });
            taskStore.setTaskError(taskId, msg);
            throw err;
          }
        }, { priority: true }).catch(() => {});
        return c.json({ taskId });
      }
      if (type === "source-pull") {
        const ref = typeof body.ref === "string" ? body.ref.trim() : "";
        if (!ref) return c.json({ error: "ref 不能为空" }, 400);
        const taskId = taskStore.createTask();
        scheduler.schedule(SOURCES_GROUP, taskId, async () => {
          taskStore.setTaskRunning(taskId);
          try {
            await getItems(ref, { cacheDir: CACHE_DIR, writeDb: true, force: true });
            taskStore.setTaskDone(taskId, { ok: true });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            taskStore.setTaskError(taskId, msg);
            throw err;
          }
        }, { priority: true }).catch(() => {});
        return c.json({ taskId });
      }
      return c.json({ error: `未知任务类型: ${type}` }, 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
