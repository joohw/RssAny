<script lang="ts">
  import { onMount } from 'svelte';

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

  function buildUrl(): string {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (filterLevel) params.set('level', filterLevel);
    if (filterCategory) params.set('category', filterCategory);
    if (filterSourceUrl.trim()) params.set('source_url', filterSourceUrl.trim());
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

  function applyFilters() {
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

  onMount(load);
</script>

<svelte:head>
  <title>日志 - RssAny</title>
</svelte:head>

<div class="page">
  <div class="page-header">
    <h1>日志</h1>
    <p class="page-desc">
      按级别、分类、信源筛选，error/warn 会落库（由 LOG_LEVEL / LOG_TO_DB 控制）
    </p>
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
      <button class="btn btn-primary" on:click={applyFilters} disabled={loading}>查询</button>
    </div>
  </div>

  {#if error}
    <div class="state err">{error}</div>
  {:else if loading && items.length === 0}
    <div class="state">加载中…</div>
  {:else if items.length === 0}
    <div class="state">暂无日志</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="th-time">时间</th>
            <th class="th-level">级别</th>
            <th class="th-cat">分类</th>
            <th class="th-msg">消息</th>
            <th class="th-source">信源</th>
            <th class="th-payload"></th>
          </tr>
        </thead>
        <tbody>
          {#each items as log (log.id)}
            <tr>
              <td class="td-time">{formatTime(log.created_at)}</td>
              <td class="td-level">
                <span class="badge level-{log.level}">{log.level}</span>
              </td>
              <td class="td-cat">{log.category}</td>
              <td class="td-msg">{log.message}</td>
              <td class="td-source" title={log.source_url ?? ''}>
                {log.source_url ? (log.source_url.length > 40 ? log.source_url.slice(0, 40) + '…' : log.source_url) : '—'}
              </td>
              <td class="td-payload">
                {#if log.payload}
                  <button
                    type="button"
                    class="payload-btn"
                    on:click={() => togglePayload(log.id)}
                    title="展开/收起 payload"
                  >
                    {expandedId === log.id ? '收起' : '…'}
                  </button>
                {:else}
                  —
                {/if}
              </td>
            </tr>
            {#if expandedId === log.id && log.payload}
              <tr class="payload-row">
                <td colspan="6">
                  <pre class="payload-content">{tryFormatPayload(log.payload)}</pre>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span class="pagination-info">
        共 {total} 条，当前 {offset + 1}–{offset + items.length}
      </span>
      <div class="pagination-btns">
        <button class="btn btn-secondary" disabled={offset <= 0 || loading} on:click={prevPage}>上一页</button>
        <button class="btn btn-secondary" disabled={offset + items.length >= total || loading} on:click={nextPage}>下一页</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .page-header h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.2rem; }
  .page-desc { font-size: 0.8rem; color: #888; margin: 0; }

  .filters {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0.75rem 1rem;
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

  .table-wrap {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
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
  .th-msg { min-width: 0; }
  .th-source { width: 120px; max-width: 120px; }
  .th-payload { width: 56px; }

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
  .td-msg { word-break: break-word; max-width: 320px; }
  .td-source {
    color: #888;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    white-space: nowrap;
  }
  .payload-btn {
    padding: 0.15rem 0.4rem;
    font-size: 0.7rem;
    border: 1px solid #e0e0e0;
    background: #f8f8f8;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    color: #666;
  }
  .payload-btn:hover { background: #eee; }

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

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.5rem 0;
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

  @media (max-width: 768px) {
    .th-source, .td-source { display: none; }
    .payload-row td { padding-left: 0.5rem; }
    .payload-row td[colspan="6"] { padding-left: 0.5rem; }
  }
</style>
