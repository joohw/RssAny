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
      if (dates.length > 0) {
        goto(`/agent-tasks/${encodeURIComponent(topic)}/${encodeURIComponent(dates[0])}`, { replaceState: true });
        return;
      }
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
        if (dates.length > 0) {
          goto(`/agent-tasks/${encodeURIComponent(topic)}/${encodeURIComponent(dates[0])}`, { replaceState: true });
        }
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

  onMount(() => {
    recoverPendingTask();
  });

  $: if (topic) {
    load();
  }
</script>

<svelte:head>
  <title>{topic} - 任务 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="header">
      <div class="header-left">
        <div class="breadcrumb">
          <a href="/agent-tasks" class="breadcrumb-link">任务</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">{topic}</span>
        </div>
      </div>
    </div>

    <div class="body">
      {#if loading}
        <div class="state">加载中…</div>
      {:else if loadError}
        <div class="state error">{loadError}</div>
      {:else}
        <div class="state empty">
          <p>该任务尚无报告</p>
          <p class="hint">点击「生成」让 Agent 按配置撰写报告</p>
          {#if generateNotice}
            <p class="gen-notice">{generateNotice}</p>
          {/if}
          {#if generateError}
            <p class="gen-error">{generateError}</p>
          {/if}
          <div class="header-actions">
            <button class="gen-btn" on:click={() => generate(true)} disabled={generating}>
              {generating ? '生成中…' : '生成'}
            </button>
          </div>
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
  .state.empty .header-actions {
    margin-top: 0.75rem;
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

  @media (max-width: 600px) {
    .wrap {
      max-width: 100%;
    }
    .col {
      border: none;
    }
  }
</style>
