// Daily = topic/日期，日报逻辑已统一到 app/topics/，此处仅保留 todayDate 与调度入口

/** 返回今天的日期字符串 YYYY-MM-DD（本地时区） */
export function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
