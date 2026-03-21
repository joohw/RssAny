<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { marked } from 'marked';
  import { fetchJson } from '$lib/fetchJson.js';

  const PENDING_KEY = 'agent-task-generate-pending';
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
    let out = raw.replace(/<table(\s[^>]*)?>/g, '<div class="table-wrap"><table$1>').replace(/<\/table>/g, '</table></div>');
    out = out.replace(/<a\s+/gi, '<a target="_blank" rel="noopener noreferrer" ');
    return out;
  }

  $: topic = decodeURIComponent($page.params.task ?? '');
  $: dateParam = $page.params.date ?? '';

  let dates: string[] = [];
  let content: string | null = null;
  let html = '';
  let loading = true;
  let loadError = '';
  let generating = false;
  let generateError = '';
  let generateNotice = '';

  async function fetchDates(): Promise<string[]> {
    if (!topic) return [];
    const data = await fetchJson<{ dates: string[] }>(
      `/api/agent-tasks/${encodeURIComponent(topic)}/dates`
    );
    return data?.dates ?? [];
  }

  async function loadContent() {
    if (!topic || !dateParam) return;
    loading = true;
    loadError = '';
    content = null;
    html = '';
    try {
      const data = await fetchJson<{ content: string | null; date: string | null }>(
        `/api/agent-tasks/${encodeURIComponent(topic)}?date=${encodeURIComponent(dateParam)}`
      );
      content = data?.content ?? null;
      if (content) {
        html = processMarkdownHtml(marked.parse(preprocessTableMarkdown(content)) as string);
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function load() {
    if (!topic || !dateParam) return;
    try {
      dates = await fetchDates();
      await loadContent();
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }

  async function pollTask(taskId: string) {
    while (!generateAborted) {
      const taskRes = await fetchJson<{
        status: string;
        result?: { skipped?: boolean; message?: string };
        error?: string;
      }>(`/api/tasks/${taskId}`);
      if (taskRes?.status === 'done') {
        dates = await fetchDates();
        await loadContent();
        generateNotice = taskRes?.result?.message ?? '已生成最新报告';
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
    generateNotice = '';
    try {
      const submitRes = await fetchJson<{ taskId?: string; error?: string }>(
        '/api/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'agent-task-generate', taskKey: topic, force }),
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

  $: currentIdx = dates.indexOf(dateParam);
  $: prevDate = currentIdx < dates.length - 1 ? dates[currentIdx + 1] : null;
  $: nextDate = currentIdx > 0 ? dates[currentIdx - 1] : null;

  onMount(() => {
    recoverPendingTask();
  });

  $: if (topic && dateParam) {
    load();
  }
</script>

<svelte:head>
  <title>{dateParam} · {topic} - 任务 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="header">
      <div class="header-left">
        <div class="breadcrumb">
          <a href="/agent-tasks" class="breadcrumb-link">任务</a>
          <span class="breadcrumb-sep">/</span>
          <a href="/agent-tasks/{encodeURIComponent(topic)}/list" class="breadcrumb-link">{topic}</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">{dateParam}</span>
        </div>
        {#if dates.length > 0}
          <div class="nav-bar">
            {#if prevDate}
              <a
                href="/agent-tasks/{encodeURIComponent(topic)}/{encodeURIComponent(prevDate)}"
                class="nav-btn"
                title="上一篇"
              >上一篇</a>
            {:else}
              <span class="nav-btn disabled">上一篇</span>
            {/if}
            {#if nextDate}
              <a
                href="/agent-tasks/{encodeURIComponent(topic)}/{encodeURIComponent(nextDate)}"
                class="nav-btn"
                title="下一篇"
              >下一篇</a>
            {:else}
              <span class="nav-btn disabled">下一篇</span>
            {/if}
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
          <p>该日报告不存在</p>
          <a href="/agent-tasks/{encodeURIComponent(topic)}/list">返回 {topic} 报告列表</a>
          {#if generateNotice}
            <p class="gen-notice">{generateNotice}</p>
          {/if}
          {#if generateError}
            <p class="gen-error">{generateError}</p>
          {/if}
        </div>
      {:else}
        {#if generateNotice}
          <div class="gen-notice-bar">{generateNotice}</div>
        {/if}
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
    height: 100vh;
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

  .breadcrumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    overflow: hidden;
  }
  .breadcrumb-link {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-primary);
    text-decoration: none;
    white-space: nowrap;
  }
  .breadcrumb-link:hover {
    text-decoration: underline;
  }
  .breadcrumb-sep {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #9ca3af;
    flex-shrink: 0;
  }
  .breadcrumb-current {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #111;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .nav-bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .nav-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.8125rem;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: #fff;
    color: #6b7280;
    cursor: pointer;
    text-decoration: none;
  }
  .nav-btn:hover:not(.disabled) {
    background: #f5f5f5;
    border-color: #d1d5db;
    color: #111;
  }
  .nav-btn.disabled {
    opacity: 0.4;
    cursor: default;
  }

  .header-actions { display: flex; align-items: center; }

  .gen-btn {
    font-size: 0.75rem;
    padding: 0.3rem 0.75rem;
    border-radius: 5px;
    border: 1px solid var(--color-primary);
    background: var(--color-primary);
    color: #fff;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .gen-btn:hover:not(:disabled) { background: var(--color-primary-hover); }
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
  .state a { color: var(--color-primary); }
  .state.error { color: #c53030; }

  .gen-error { color: #c53030; font-size: 0.75rem; margin-top: 0.5rem; }
  .gen-notice { color: #6b7280; font-size: 0.75rem; margin-top: 0.5rem; }
  .gen-notice-bar {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    color: #4b5563;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }
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
  .markdown-body :global(a) { color: var(--color-primary); text-decoration: none; }
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
