// 后端任务：提交后立即返回 taskId，任务在后台执行，前端轮询状态

const tasks = new Map<string, { id: string; status: string; result?: unknown; error?: string; createdAt: number; updatedAt: number }>();
let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `t_${Date.now().toString(36)}_${idCounter}`;
}

export function createTask(): string {
  const id = nextId();
  const now = Date.now();
  tasks.set(id, { id, status: "pending", createdAt: now, updatedAt: now });
  return id;
}

export function getTask(id: string) {
  return tasks.get(id) ?? null;
}

export function setTaskRunning(id: string): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "running";
    t.updatedAt = Date.now();
  }
}

export function setTaskDone<T>(id: string, result: T): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "done";
    t.result = result as unknown;
    t.updatedAt = Date.now();
  }
}

export function setTaskError(id: string, error: string): void {
  const t = tasks.get(id);
  if (t) {
    t.status = "error";
    t.error = error;
    t.updatedAt = Date.now();
  }
}

/** 清理 1 小时前的已完成/失败任务 */
export function pruneTasks(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, t] of tasks) {
    if ((t.status === "done" || t.status === "error") && t.updatedAt < cutoff) {
      tasks.delete(id);
    }
  }
}
