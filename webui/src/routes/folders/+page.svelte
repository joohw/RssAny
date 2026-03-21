<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { fetchJson } from '$lib/fetchJson.js';
  import {
    cancelFolderSearchSchedule,
    scheduleFolderSearch,
    type FolderSearchHit,
  } from '$lib/folderSearchSchedule.js';
  import {
    peekSandboxFolderRel,
    stashSandboxFileRel,
    stashSandboxFolderRel,
  } from '$lib/sandboxFileNav.js';
  import Folder from 'lucide-svelte/icons/folder';
  import File from 'lucide-svelte/icons/file';
  import Search from 'lucide-svelte/icons/search';

  interface Entry {
    name: string;
    type: 'directory' | 'file';
  }

  type ListRow = Entry & { relPath?: string };

  let entries: Entry[] = [];
  let loading = true;
  let error = '';
  /** 递归搜索关键词；空则仅展示当前目录 */
  let filterQuery = '';
  let lastListPath = '';

  let searchMatches: FolderSearchHit[] | null = null;
  let searchLoading = false;
  let searchError = '';
  let searchTruncated = false;
  let searchTimedOut = false;
  /** 与接口返回的 matchLimit 一致，用于截断提示 */
  let searchMatchLimit = 800;

  function entryFolderRel(): string {
    if (!browser) return '';
    return peekSandboxFolderRel();
  }

  let pathRel = entryFolderRel();

  afterNavigate(({ to }) => {
    if (to?.url.pathname !== '/folders') return;
    const next = peekSandboxFolderRel();
    if (next !== pathRel) pathRel = next;
  });

  $: if (pathRel !== lastListPath) {
    lastListPath = pathRel;
    filterQuery = '';
  }

  $: {
    const q = filterQuery.trim();
    const basePath = pathRel;
    if (!q) {
      cancelFolderSearchSchedule();
      searchMatches = null;
      searchLoading = false;
      searchError = '';
      searchTruncated = false;
      searchTimedOut = false;
      searchMatchLimit = 800;
    } else {
      scheduleFolderSearch(basePath, q, {
        onLoading: (v) => {
          searchLoading = v;
        },
        onSuccess: (r) => {
          searchMatches = r.entries;
          searchTruncated = r.truncated;
          searchTimedOut = r.timedOut;
          if (typeof r.matchLimit === 'number') searchMatchLimit = r.matchLimit;
          searchError = '';
        },
        onError: (msg) => {
          searchError = msg;
          searchMatches = [];
        },
      });
    }
  }

  $: filterNorm = filterQuery.trim().length > 0;

  let listRows: ListRow[] = [];
  /** 有搜索词时用递归结果，否则当前目录 */
  $: listRows = filterNorm ? (searchMatches ?? []) : entries;

  async function loadList(rel: string) {
    loading = true;
    error = '';
    try {
      const q = rel ? `?rel=${encodeURIComponent(rel)}` : '';
      const data = await fetchJson<{
        path?: string;
        entries?: Entry[];
        error?: string;
      }>(`/api/project-dirs${q}`);
      if (data?.error) throw new Error(data.error);
      entries = data?.entries ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      entries = [];
    } finally {
      loading = false;
    }
  }

  $: loadList(pathRel);

  function goFolder(rel: string): void {
    stashSandboxFolderRel(rel);
    goto('/folders', { replaceState: true, noScroll: true });
  }

  function openDir(name: string) {
    const next = pathRel ? `${pathRel}/${name}` : name;
    goFolder(next);
  }

  function fileRel(name: string): string {
    return pathRel ? `${pathRel}/${name}` : name;
  }

  function isMd(name: string): boolean {
    return name.toLowerCase().endsWith('.md');
  }

  function openMd(name: string) {
    stashSandboxFileRel(fileRel(name));
    goto('/folders/file', { replaceState: true, noScroll: true });
  }

  function openDirRel(rel: string) {
    goFolder(rel);
  }

  function openFileRel(rel: string) {
    stashSandboxFileRel(rel);
    goto('/folders/file', { replaceState: true, noScroll: true });
  }

  function rowKey(e: ListRow): string {
    return e.relPath ?? e.name;
  }
</script>

<svelte:head>
  <title>文件夹 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <nav class="crumb-bar" aria-label="路径">
      <div class="crumb-bar-row">
        <div class="crumb">
          <a
            href="/folders"
            class="crumb-link"
            on:click={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              goFolder('');
            }}>根目录</a>
          {#each pathRel.split('/').filter(Boolean) as seg, i}
            {@const prefix = pathRel.split('/').filter(Boolean).slice(0, i + 1).join('/')}
            <span class="crumb-sep">/</span>
            <a
              href="/folders"
              class="crumb-link"
              on:click={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                goFolder(prefix);
              }}>{seg}</a>
          {/each}
        </div>
        {#if !loading && !error}
          <div class="crumb-search">
            <label class="filter-label" for="folders-filter">
              <span class="filter-icon" aria-hidden="true"><Search size={16} /></span>
              <span class="sr-only">筛选</span>
            </label>
            <input
              id="folders-filter"
              class="filter-input"
              type="search"
              placeholder="递归搜索…"
              autocomplete="off"
              spellcheck="false"
              bind:value={filterQuery}
            />
          </div>
        {/if}
      </div>
    </nav>

    {#if loading}
      <div class="state">加载中…</div>
    {:else if error}
      <div class="state err">{error}</div>
    {:else if !filterNorm && entries.length === 0}
      <div class="state">空目录</div>
    {:else if filterNorm && searchLoading}
      <div class="state">搜索中…</div>
    {:else if filterNorm && searchError}
      <div class="state err">{searchError}</div>
    {:else if filterNorm && listRows.length === 0}
      <div class="state">没有与「{filterQuery.trim()}」匹配的文件或文件夹</div>
    {:else}
      {#if filterNorm && searchTimedOut && listRows.length > 0}
        <div class="search-trunc search-timed" role="note">
          搜索已限时结束（目录可能过大），以下为已扫到的部分结果，可在更浅的文件夹下再搜
        </div>
      {:else if filterNorm && searchTruncated && listRows.length > 0}
        <div class="search-trunc" role="note">命中较多，仅显示前 {searchMatchLimit} 条</div>
      {/if}
      <ul class="list">
        {#each listRows as e (rowKey(e))}
          <li>
            {#if e.type === 'directory'}
              <button
                type="button"
                class="row dir"
                on:click={() => (e.relPath ? openDirRel(e.relPath) : openDir(e.name))}
              >
                <span class="icon"><Folder size={18} /></span>
                <span class="row-text">
                  <span class="name">{e.name}</span>
                  {#if e.relPath}
                    <span class="rel-path" title={e.relPath}>{e.relPath}</span>
                  {/if}
                </span>
              </button>
            {:else if isMd(e.name)}
              <button
                type="button"
                class="row file md"
                on:click={() => (e.relPath ? openFileRel(e.relPath) : openMd(e.name))}
                title="打开 Markdown"
              >
                <span class="icon"><File size={18} /></span>
                <span class="row-text">
                  <span class="name">{e.name}</span>
                  {#if e.relPath}
                    <span class="rel-path" title={e.relPath}>{e.relPath}</span>
                  {/if}
                </span>
              </button>
            {:else}
              <div class="row file disabled">
                <span class="icon muted"><File size={18} /></span>
                <span class="row-text">
                  <span class="name muted">{e.name}</span>
                  {#if e.relPath}
                    <span class="rel-path muted" title={e.relPath}>{e.relPath}</span>
                  {/if}
                </span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .wrap {
    height: 100vh;
    display: flex;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
    overflow: hidden;
  }
  .crumb-bar {
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
    background: #fff;
  }
  .crumb-bar-row {
    display: flex;
    align-items: center;
    gap: 0.65rem 0.85rem;
    min-width: 0;
  }
  .crumb {
    font-size: 0.9375rem;
    line-height: 1.45;
    font-weight: 500;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.25rem 0.35rem;
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .crumb-search {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: 0 0 auto;
    width: min(13.5rem, 38vw);
    min-width: 6.75rem;
  }
  .crumb-link {
    color: var(--color-primary);
    text-decoration: none;
  }
  .crumb-link:hover { text-decoration: underline; }
  .crumb-sep {
    color: #d1d5db;
    font-weight: 400;
    user-select: none;
  }

  .filter-label {
    display: flex;
    align-items: center;
    color: #6b7280;
    flex-shrink: 0;
  }
  .filter-input {
    flex: 1;
    min-width: 0;
    padding: 0.32rem 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.875rem;
    background: #fff;
    color: #111;
  }
  .filter-input:focus {
    outline: none;
    border-color: var(--color-primary, #2563eb);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
  }
  .filter-input::placeholder {
    color: #9ca3af;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .search-trunc {
    flex-shrink: 0;
    padding: 0.45rem 1.25rem;
    font-size: 0.75rem;
    color: #6b7280;
    background: #fffbeb;
    border-bottom: 1px solid #fde68a;
  }
  .search-timed {
    background: #fef3c7;
    border-bottom-color: #f59e0b;
  }

  .state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 0.875rem;
  }
  .state.err { color: #c53030; }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 0.65rem 1.25rem;
    border: none;
    border-bottom: 1px solid #f3f4f6;
    background: #fff;
    font: inherit;
    cursor: default;
  }
  .row.dir {
    cursor: pointer;
  }
  .row.dir:hover { background: #fafafa; }
  .row.file.md {
    cursor: pointer;
  }
  .row.file.md:hover { background: #fafafa; }
  .row.file.md .icon { color: #374151; }
  .row.file.disabled { cursor: default; }
  .icon { display: flex; color: #374151; }
  .icon.muted { color: #9ca3af; }
  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
  }
  .name { font-size: 0.875rem; color: #111; }
  .name.muted { color: #9ca3af; }
  .rel-path {
    font-size: 0.75rem;
    color: #6b7280;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rel-path.muted { color: #9ca3af; }

  @media (max-width: 600px) {
    .wrap { max-width: 100%; }
    .col { border: none; }
    .crumb-bar-row {
      flex-wrap: nowrap;
    }
    .crumb-search {
      width: min(10rem, 34vw);
      min-width: 5.5rem;
    }
  }
</style>
