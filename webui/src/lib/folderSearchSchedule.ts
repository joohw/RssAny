/**
 * 文件夹递归搜索的防抖与请求：定时器放在模块作用域，避免 Svelte `$:` 误订阅 `searchDebounceTimer`
 * 导致「每次 setTimeout 又触发 reactive → clearTimeout」、请求永远发不出去、一直显示搜索中。
 */

import { fetchJson } from './fetchJson.js';

export interface FolderSearchHit {
  name: string;
  type: 'directory' | 'file';
  relPath: string;
}

export interface FolderSearchHandlers {
  onLoading: (loading: boolean) => void;
  onSuccess: (r: {
    entries: FolderSearchHit[];
    truncated: boolean;
    timedOut: boolean;
    matchLimit?: number;
  }) => void;
  onError: (message: string) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let abortRef: AbortController | null = null;

const gen = (() => {
  let n = 0;
  return { issue: () => ++n, current: () => n };
})();

export function cancelFolderSearchSchedule(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  abortRef?.abort();
  abortRef = null;
}

export function scheduleFolderSearch(basePath: string, q: string, handlers: FolderSearchHandlers): void {
  cancelFolderSearchSchedule();
  handlers.onLoading(true);
  handlers.onError('');

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    const myId = gen.issue();
    const ac = new AbortController();
    abortRef = ac;
    let aborted = false;
    const stallGuard = setTimeout(() => {
      if (myId !== gen.current()) return;
      ac.abort();
      handlers.onError('等待过久未收到结果，请缩小目录或重试');
      handlers.onSuccess({ entries: [], truncated: false, timedOut: false });
      handlers.onLoading(false);
    }, 52_000);
    try {
      const params = new URLSearchParams();
      if (basePath) params.set('rel', basePath);
      params.set('q', q);
      const data = await fetchJson<{
        entries?: FolderSearchHit[];
        truncated?: boolean;
        timedOut?: boolean;
        matchLimit?: number;
        error?: string;
      }>(`/api/project-dirs?${params}`, { signal: ac.signal });
      if (myId !== gen.current()) return;
      if (data?.error) throw new Error(data.error);
      handlers.onSuccess({
        entries: data?.entries ?? [],
        truncated: data?.truncated === true,
        timedOut: data?.timedOut === true,
        matchLimit: data?.matchLimit,
      });
    } catch (e) {
      const isAbort =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (isAbort) {
        aborted = true;
        return;
      }
      if (myId !== gen.current()) return;
      handlers.onError(e instanceof Error ? e.message : String(e));
      handlers.onSuccess({ entries: [], truncated: false, timedOut: false });
    } finally {
      clearTimeout(stallGuard);
      if (abortRef === ac) abortRef = null;
      if (!aborted && myId === gen.current()) handlers.onLoading(false);
    }
  }, 320);
}
