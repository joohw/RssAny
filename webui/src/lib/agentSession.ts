// 模块级 store：切换页面时保留聊天状态，避免组件卸载导致丢失

import { writable, get } from 'svelte/store';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
  }>;
  usage?: {
    input?: number;
    output?: number;
    totalTokens: number;
    cost?: { total: number };
  };
}

const STORAGE_KEY = 'MainSession';

function loadFromStorage(): AgentMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return [];
    const parsed = JSON.parse(cached) as AgentMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(messages: AgentMessage[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

// 模块级 store，切换路由时保留
const _messages = writable<AgentMessage[]>(loadFromStorage());

_messages.subscribe((msgs) => {
  saveToStorage(msgs);
});

/** 从 localStorage 重新加载（页面挂载时调用，防止 store 被重置） */
export function rehydrateAgentMessages(): void {
  if (typeof localStorage === 'undefined') return;
  const stored = loadFromStorage();
  if (stored.length > 0 && get(_messages).length === 0) {
    _messages.set(stored);
  }
}

export const agentMessages = {
  subscribe: _messages.subscribe,
  set: _messages.set,
  update: _messages.update,
  get: () => get(_messages),
  clear: () => {
    _messages.set([]);
    saveToStorage([]);
  },
};
