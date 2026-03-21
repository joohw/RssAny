<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fetchJson } from '$lib/fetchJson.js';

  const PENDING_KEY = 'agent-task-generate-pending';
  let generateAborted = false;
  onDestroy(() => { generateAborted = true; });

  $: topic = decodeURIComponent($page.params.task ?? '');

  let dates: string[] = [];
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

  async function load() {
    if (!topic) return;
    loading = true;
    loadError = '';
    try {
      dates = await fetchDates();
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      dates = [];
    } finally {
      loading = false;
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

  function openArticle(date: string) {
    goto(`/agent-tasks/${encodeURIComponent(topic)}/${encodeURIComponent(date)}`);
  }

  onMount(() => {
    recoverPendingTask();
  });

  $: if (topic) {
    load();
  }
</script>

<svelte:head>
  <title>报告列表 · {topic} - 任务 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="header">
      <div class="header-left">
        <div class="breadcrumb">
          <a href="/agent-tasks" class="breadcrumb-link">任务</a>
          <span class="breadcrumb-sep">/</span>
          <a href="/agent-tasks/{encodeURIComponent(topic)}" class="breadcrumb-link">{topic}</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">报告列表</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="gen-btn" on:click={() => generate(true)} disabled={generating}>
          {generating ? '生成中…' : '生成'}
        </button>
      </div>
    </div>

    <div class="body">
      {#if loading}
        <div class="state">加载中…</div>
      {:else if loadError}
        <div class="state error">{loadError}</div>
      {:else if dates.length === 0}
        <div class="state empty">
          <p>该话题尚无报告</p>
          <p class="hint">点击「生成」让 Agent 基于近期文章撰写追踪报告</p>
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
        <ul class="article-list">
          {#each dates as date (date)}
            <li>
              <a
                href="/agent-tasks/{encodeURIComponent(topic)}/{encodeURIComponent(date)}"
                class="article-link"
                on:click|preventDefault={() => openArticle(date)}
              >
                <span class="article-date">{date}</span>
                <span class="article-label">追踪报告</span>
              </a>
            </li>
          {/each}
        </ul>
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
    flex: 1;
    min-width: 0;
  }

  .breadcrumb {
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

  .header-actions {
    display: flex;
    align-items: center;
  }

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
  .gen-btn:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }
  .gen-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 1.25rem;
  }
  .body::-webkit-scrollbar {
    width: 4px;
  }
  .body::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
  }

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: #888;
    font-size: 0.875rem;
    text-align: center;
    gap: 0.4rem;
  }
  .state p {
    margin: 0;
  }
  .state.error {
    color: #c53030;
  }
  .state.empty .hint {
    font-size: 0.75rem;
    color: #aaa;
  }
  .gen-error {
    color: #c53030;
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }
  .gen-notice {
    color: #6b7280;
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }
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

  .article-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .article-list li {
    border-bottom: 1px solid #e5e7eb;
  }
  .article-list li:last-child {
    border-bottom: none;
  }
  .article-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 0;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    transition: background 0.15s;
    border-radius: 4px;
    margin: 0 -0.5rem;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
  .article-link:hover {
    background: #fafafa;
  }
  .article-date {
    font-size: 0.9375rem;
    font-weight: 500;
    color: #111;
  }
  .article-link:hover .article-date {
    color: var(--color-primary);
  }
  .article-label {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  @media (max-width: 600px) {
    .wrap {
      max-width: 100%;
    }
    .col {
      border: none;
    }
  }
</style>
