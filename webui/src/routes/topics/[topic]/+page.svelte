<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { marked } from 'marked';
  import { fetchJson } from '$lib/fetchJson.js';

  const PENDING_KEY = 'topic-generate-pending';
  let generateAborted = false;
  onDestroy(() => { generateAborted = true; });

  marked.setOptions({ breaks: true, gfm: true });

  function preprocessTableMarkdown(text: string): string {
    let out = text;
    out = out.replace(/```[\w]*\n([\s\S]*?)```/g, (match, code) => {
      const trimmed = code.trim();
      if (/^\|.+\|\s*\n\s*\|[-:\s|]+\|\s*\n/m.test(trimmed)) return trimmed;
      return match;
    });
    out = out.replace(/^(\s{2,})\|/gm, '|');
    return out;
  }

  function processMarkdownHtml(raw: string): string {
    return raw.replace(/<table(\s[^>]*)?>/g, '<div class="table-wrap"><table$1>').replace(/<\/table>/g, '</table></div>');
  }

  $: topic = decodeURIComponent($page.params.topic ?? '');

  let dates: string[] = [];
  let currentDate = '';
  let content: string | null = null;
  let html = '';
  let loading = true;
  let loadError = '';
  let generating = false;
  let generateError = '';

  async function fetchDates(): Promise<string[]> {
    if (!topic) return [];
    const data = await fetchJson<{ dates: string[] }>(
      `/api/topics/${encodeURIComponent(topic)}/dates`
    );
    return data?.dates ?? [];
  }

  async function loadContent(date: string) {
    if (!topic) return;
    loading = true;
    loadError = '';
    content = null;
    html = '';
    try {
      const data = await fetchJson<{ content: string | null; date: string | null }>(
        `/api/topics/${encodeURIComponent(topic)}?date=${encodeURIComponent(date)}`
      );
      content = data?.content ?? null;
      currentDate = data?.date ?? date;
      html = content ? processMarkdownHtml(marked.parse(preprocessTableMarkdown(content)) as string) : '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function load() {
    if (!topic) return;
    loading = true;
    loadError = '';
    content = null;
    html = '';
    try {
      dates = await fetchDates();
      if (dates.length === 0) {
        loading = false;
        return;
      }
      currentDate = dates[0];
      await loadContent(currentDate);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  }

  async function pollTask(taskId: string) {
    while (!generateAborted) {
      const taskRes = await fetchJson<{ status: string; result?: unknown; error?: string }>(
        `/api/tasks/${taskId}`
      );
      if (taskRes?.status === 'done') {
        await load();
        if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_KEY);
        break;
      }
      if (taskRes?.status === 'error') {
        generateError = taskRes?.error ?? '生成失败';
        if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_KEY);
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  async function generate(force = false) {
    if (!topic) return;
    generating = true;
    generateError = '';
    try {
      const submitRes = await fetchJson<{ taskId?: string; error?: string }>(
        '/api/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'topic-generate', topicKey: topic, force }),
        }
      );
      const taskId = submitRes?.taskId;
      if (!taskId) {
        generateError = submitRes?.error ?? '提交失败';
        return;
      }
      if (typeof window !== 'undefined') sessionStorage.setItem(PENDING_KEY, JSON.stringify({ topic, taskId }));
      await pollTask(taskId);
    } catch (e) {
      generateError = e instanceof Error ? e.message : String(e);
      if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_KEY);
    } finally {
      generating = false;
    }
  }

  async function recoverPendingTask() {
    if (!topic || generating) return;
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(PENDING_KEY) : null;
      if (!raw) return;
      const { topic: storedTopic, taskId } = JSON.parse(raw) as { topic?: string; taskId?: string };
      if (storedTopic !== topic || !taskId) return;
      generating = true;
      await pollTask(taskId);
    } finally {
      generating = false;
    }
  }

  function goPrev() {
    const idx = dates.indexOf(currentDate);
    if (idx < dates.length - 1) {
      const prev = dates[idx + 1];
      loadContent(prev);
    }
  }

  function goNext() {
    const idx = dates.indexOf(currentDate);
    if (idx > 0) {
      const next = dates[idx - 1];
      loadContent(next);
    }
  }

  $: hasPrev = dates.length > 0 && dates.indexOf(currentDate) < dates.length - 1;
  $: hasNext = dates.length > 0 && dates.indexOf(currentDate) > 0;

  onMount(() => {
    recoverPendingTask();
  });

  $: if (topic) {
    load();
  }
</script>

<svelte:head>
  <title>{topic} - 话题追踪 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="header">
      <div class="header-left">
        <a href="/topics" class="back-link" title="返回话题">← 话题</a>
        <h2>{topic}</h2>
        {#if dates.length > 0}
          <div class="nav-bar">
            <button
              type="button"
              class="nav-btn"
              disabled={!hasPrev}
              title="上一篇"
              on:click={goPrev}
            >←</button>
            <span class="nav-date">{currentDate}</span>
            <button
              type="button"
              class="nav-btn"
              disabled={!hasNext}
              title="下一篇"
              on:click={goNext}
            >→</button>
          </div>
        {/if}
      </div>
      <div class="header-actions">
        <button class="gen-btn" on:click={() => generate(true)} disabled={generating}>
          {generating ? '生成中…' : '生成'}
        </button>
      </div>
    </div>

    <div class="body">
      {#if loading && !content}
        <div class="state">加载中…</div>
      {:else if loadError && !content}
        <div class="state error">{loadError}</div>
      {:else if !content}
        <div class="state empty">
          <p>该话题尚无报告</p>
          <p class="hint">点击「生成」让 Agent 基于近期文章撰写追踪报告</p>
          {#if generateError}
            <p class="gen-error">{generateError}</p>
          {/if}
        </div>
      {:else}
        {#if generateError}
          <div class="gen-error-bar">{generateError}</div>
        {/if}
        <div class="markdown-body" role="article">
          {@html html}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }

  .header {
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    flex-wrap: wrap;
  }

  .back-link {
    font-size: 0.8125rem;
    color: #0969da;
    text-decoration: none;
  }
  .back-link:hover { text-decoration: underline; }

  .header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  .nav-bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .nav-btn {
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: #fff;
    color: #6b7280;
    cursor: pointer;
  }
  .nav-btn:hover:not(:disabled) {
    background: #f5f5f5;
    border-color: #d1d5db;
    color: #111;
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .nav-date {
    font-size: 0.75rem;
    color: #6b7280;
    min-width: 5rem;
    text-align: center;
  }

  .header-actions { display: flex; align-items: center; }

  .gen-btn {
    font-size: 0.75rem;
    padding: 0.3rem 0.75rem;
    border-radius: 5px;
    border: 1px solid #0969da;
    background: #0969da;
    color: #fff;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .gen-btn:hover:not(:disabled) { background: #0757b8; }
  .gen-btn:disabled { opacity: 0.5; cursor: default; }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 1.25rem;
  }
  .body::-webkit-scrollbar { width: 4px; }
  .body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: #888;
    font-size: 0.875rem;
    text-align: center;
    gap: 0.4rem;
  }
  .state p { margin: 0; }
  .state.error { color: #c53030; }
  .state.empty .hint { font-size: 0.75rem; color: #aaa; }

  .gen-error { color: #c53030; font-size: 0.75rem; margin-top: 0.5rem; }
  .gen-error-bar {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    color: #c53030;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }

  .markdown-body {
    font-size: 0.9rem;
    line-height: 1.75;
    color: #1a1a1a;
  }
  .markdown-body :global(h1) {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
    color: #111;
  }
  .markdown-body :global(h2) {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 1.75rem 0 0.5rem;
    color: #111;
    border-bottom: 1px solid #f0f0f0;
    padding-bottom: 0.25rem;
  }
  .markdown-body :global(h3) {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 1.25rem 0 0.4rem;
    color: #333;
  }
  .markdown-body :global(p) {
    margin: 0.6rem 0;
    color: #444;
  }
  .markdown-body :global(blockquote) {
    margin: 0.75rem 0;
    padding: 0.25rem 0.875rem;
    border-left: 3px solid #e5e7eb;
    color: #888;
    font-size: 0.8125rem;
  }
  .markdown-body :global(ul), .markdown-body :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }
  .markdown-body :global(li) {
    margin: 0.25rem 0;
    color: #444;
  }
  .markdown-body :global(strong) { color: #111; }
  .markdown-body :global(a) { color: #0969da; text-decoration: none; }
  .markdown-body :global(a:hover) { text-decoration: underline; }
  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 1.5rem 0;
  }
  .markdown-body :global(.table-wrap) {
    overflow-x: auto;
    margin: 0.75rem 0;
    -webkit-overflow-scrolling: touch;
  }
  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    min-width: 200px;
    font-size: 0.875rem;
  }
  .markdown-body :global(thead) { display: table-header-group; }
  .markdown-body :global(tbody) { display: table-row-group; }
  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid #e5e7eb;
    padding: 0.4em 0.6em;
    text-align: left;
    word-break: break-word;
    vertical-align: top;
  }
  .markdown-body :global(th) {
    background: #f5f5f5;
    font-weight: 600;
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .wrap { max-width: 100%; }
    .col { border: none; }
  }
</style>
