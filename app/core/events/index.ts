// 事件总线：进程内单例 EventEmitter，供 db 层 emit、HTTP 层 subscribe

import { EventEmitter } from "node:events";


/** feed:updated 事件的载荷 */
export interface FeedUpdatedEvent {
  sourceUrl: string;
  newCount: number;
}


/** 全局单例事件总线，setMaxListeners 避免 SSE 多连接时的警告 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);


/** 向事件总线广播新条目事件 */
export function emitFeedUpdated(payload: FeedUpdatedEvent): void {
  eventBus.emit("feed:updated", payload);
}


/** 订阅 feed:updated 事件，返回取消订阅函数 */
export function onFeedUpdated(fn: (e: FeedUpdatedEvent) => void): () => void {
  eventBus.on("feed:updated", fn);
  return () => eventBus.off("feed:updated", fn);
}
