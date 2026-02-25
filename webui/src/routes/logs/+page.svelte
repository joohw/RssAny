<script lang="ts">
  const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
  const CATEGORIES = ['feeder', 'scheduler', 'enrich', 'db', 'auth', 'plugin', 'source', 'llm', 'app', 'config'] as const;

  interface LogItem {
    id: number;
    level: string;
    category: string;
    message: string;
    payload: string | null;
    source_url: string | null;
    created_at: string;
  }

  let items: LogItem[] = [];
  let total = 0;
  let loading = false;
  let error = '';
  let filterLevel = '';
  let filterCategory = '';
  let filterSourceUrl = '';
  let offset = 0;
  let expandedId: number | null = null;

  const PAGE_SIZE = 50;

  // 级别、分类变更时直接重新加载
  $: {
    void filterLevel;
    void filterCategory;
    offset = 0;
    load();
  }

  // 信源 URL 防抖 400ms 后参与请求
  let filterSourceUrlApplied = filterSourceUrl;
  let sourceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  $: {
    const _ = filterSourceUrl;
    if (sourceDebounceTimer) clearTimeout(sourceDebounceTimer);
    sourceDebounceTimer = setTimeout(() => {
      if (filterSourceUrl !== filterSourceUrlApplied) {
        filterSourceUrlApplied = filterSourceUrl;
        offset = 0;
        load();
      }
      sourceDebounceTimer = null;
    }, 400);
  }

  function buildUrl(): string {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (filterLevel) params.set('level', filterLevel);
    if (filterCategory) params.set('category', filterCategory);
    if (filterSourceUrlApplied.trim()) params.set('source_url', filterSourceUrlApplied.trim());
    return '/api/logs?' + params.toString();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      const data: { items: LogItem[]; total: number } = await res.json();
      items = data.items ?? [];
      total = data.total ?? 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      items = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  function refresh() {
    offset = 0;
    load();
  }

  function prevPage() {
    if (offset <= 0) return;
    offset = Math.max(0, offset - PAGE_SIZE);
    load();
  }

  function nextPage() {
    if (offset + items.length >= total) return;
    offset += PAGE_SIZE;
    load();
  }

  function togglePayload(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }

  function tryFormatPayload(payload: string | null): string {
    if (!payload) return '';
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }

</script>

<svelte:head>
  <title>日志 - RssAny</title>
</svelte:head>

<div class="page">
  <div class="logs-col">
    <div class="logs-header">
      <h2>日志</h2>
    </div>
    <div class="filters">
      <div class="filter-row">
        <label>
          <span>级别</span>
          <select bind:value={filterLevel}>
            <option value="">全部</option>
            {#each LEVELS as l}
              <option value={l}>{l}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>分类</span>
          <select bind:value={filterCategory}>
            <option value="">全部</option>
            {#each CATEGORIES as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </label>
        <label class="filter-source">
          <span>信源 URL</span>
          <input type="text" bind:value={filterSourceUrl} placeholder="可选，按 source_url 过滤" />
        </label>
        <button class="btn btn-secondary" on:click={refresh} disabled={loading} title="刷新">刷新</button>
      </div>
    </div>

  <div class="log-area">
  {#if error}
    <div class="state err">{error}</div>
  {:else if loading && items.length === 0}
    <div class="state">加载中…</div>
  {:else if items.length === 0}
    <div class="state">暂无日志</div>
  {:else}
    <div class="log-toolbar">
      <span class="pagination-info">共 {total} 条，当前 {items.length ? `${offset + 1}–${offset + items.length}` : '—'}</span>
      <div class="pagination-btns">
        <button class="btn btn-secondary btn-sm" disabled={offset <= 0 || loading} on:click={prevPage}>上一页</button>
        <button class="btn btn-secondary btn-sm" disabled={offset + items.length >= total || loading} on:click={nextPage}>下一页</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="th-time">时间</th>
            <th class="th-level">级别</th>
            <th class="th-cat">分类</th>
            <th class="th-source">信源</th>
            <th class="th-msg">消息</th>
          </tr>
        </thead>
        <tbody>
          {#each items as log (log.id)}
            <tr
              class="log-row"
              role="button"
              tabindex="0"
              on:click={() => togglePayload(log.id)}
              on:keydown={(e) => e.key === 'Enter' && togglePayload(log.id)}
            >
              <td class="td-time">{formatTime(log.created_at)}</td>
              <td class="td-level">
                <span class="badge level-{log.level}">{log.level}</span>
              </td>
              <td class="td-cat">{log.category}</td>
              <td class="td-source" title={log.source_url ?? ''}>
                {log.source_url ? (log.source_url.length > 40 ? log.source_url.slice(0, 40) + '…' : log.source_url) : '—'}
              </td>
              <td class="td-msg">{log.message}</td>
            </tr>
            {#if expandedId === log.id && log.payload}
              <tr class="payload-row">
                <td colspan="5">
                  <pre class="payload-content">{tryFormatPayload(log.payload)}</pre>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

  {/if}
  </div>
  </div>
</div>

<style>
  .page {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .logs-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }

  .logs-header {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .logs-header h2 { font-size: 0.9375rem; font-weight: 600; margin: 0 0 0.15rem; }
  .logs-header .page-desc { font-size: 0.75rem; color: #aaa; margin: 0; }

  .log-area {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .log-area::-webkit-scrollbar { width: 4px; }
  .log-area::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .filters {
    border-bottom: 1px solid #f0f0f0;
    padding: 0.75rem 1.25rem;
    flex-shrink: 0;
  }
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .filter-row label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8125rem;
    color: #555;
  }
  .filter-row label span { white-space: nowrap; }
  .filter-row select {
    padding: 0.35rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 5px;
    font-size: 0.8125rem;
    font-family: inherit;
    min-width: 6rem;
  }
  .filter-source input {
    padding: 0.35rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 5px;
    font-size: 0.8125rem;
    font-family: inherit;
    width: 220px;
    max-width: 100%;
  }
  .filter-source input::placeholder { color: #aaa; }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 0.4rem 0.9rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
    transition: background 0.15s;
  }
  .btn-primary { background: #111; color: #fff; }
  .btn-primary:hover:not(:disabled) { background: #333; }
  .btn-secondary { background: #f0f0f0; color: #333; }
  .btn-secondary:hover:not(:disabled) { background: #e0e0e0; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }

  .table-wrap {
    flex: 1;
  }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #fafafa;
    font-size: 0.72rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid #eee;
  }
  tbody tr { border-bottom: 1px solid #f5f5f5; }
  tbody tr:hover { background: #fafafa; }
  tbody td { padding: 0.5rem 0.75rem; font-size: 0.8125rem; vertical-align: middle; }

  .th-time { width: 130px; }
  .th-level { width: 68px; }
  .th-cat { width: 82px; }
  .th-source { width: 120px; max-width: 120px; }
  .th-msg { min-width: 0; }

  .log-row {
    cursor: pointer;
  }
  .log-row:focus {
    outline: 1px dotted #999;
    outline-offset: -1px;
  }

  .td-time { color: #888; white-space: nowrap; }
  .td-level { white-space: nowrap; }
  .badge {
    display: inline-block;
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
  }
  .badge.level-error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .badge.level-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .badge.level-info { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; }
  .badge.level-debug { background: #f5f5f5; color: #666; border: 1px solid #e5e5e5; }

  .td-cat { color: #555; }
  .td-source {
    color: #888;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    white-space: nowrap;
  }
  .td-msg { word-break: break-word; max-width: 320px; }

  .payload-row td { padding: 0 0.75rem 0.5rem; background: #fafafa; border-bottom: 1px solid #eee; vertical-align: top; }
  .payload-content {
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.72rem;
    line-height: 1.5;
    background: #fff;
    border: 1px solid #eee;
    border-radius: 6px;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }

  .pagination-info { font-size: 0.8125rem; color: #888; }
  .pagination-btns { display: flex; gap: 0.5rem; }

  .state {
    text-align: center;
    padding: 3rem 1.5rem;
    color: #aaa;
    font-size: 0.875rem;
  }
  .state.err { color: #b91c1c; background: #fef2f2; border-radius: 8px; padding: 1rem; }

  @media (max-width: 720px) {
    .page { max-width: 100%; }
    .logs-col { border: none; }
    .th-source, .td-source { display: none; }
    .payload-row td { padding-left: 0.5rem; }
    .payload-row td[colspan="5"] { padding-left: 0.5rem; }
  }
</style>
