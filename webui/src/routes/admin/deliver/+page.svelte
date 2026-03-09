<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJson } from '$lib/fetchJson.js';
  import { showToast } from '$lib/toastStore.js';

  let enabled = false;
  let url = '';
  let loading = true;
  let saving = false;
  let testing = false;

  async function load() {
    loading = true;
    try {
      const data = await fetchJson<{ enabled?: boolean; url?: string }>('/api/deliver');
      enabled = data?.enabled ?? false;
      url = data?.url ?? '';
    } catch {
      enabled = false;
      url = '';
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    try {
      const data = await fetchJson<{ ok?: boolean; message?: string; enabled?: boolean; url?: string }>(
        '/api/deliver',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, url: url.trim() }),
        }
      );
      if (!data?.ok) throw new Error(data?.message ?? '保存失败');
      enabled = data?.enabled ?? enabled;
      url = data?.url ?? url;
      showToast('已保存', 'success');
    } catch (e) {
      showToast('保存失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      saving = false;
    }
  }

  async function test() {
    const target = url.trim();
    if (!target) {
      showToast('请先填写投递 URL', 'error');
      return;
    }
    testing = true;
    try {
      const data = await fetchJson<{ ok?: boolean; message?: string }>(
        '/api/deliver/test',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target }),
        }
      );
      if (data?.ok) {
        showToast('投递测试成功', 'success');
      } else {
        showToast('投递测试失败: ' + (data?.message ?? '未知错误'), 'error');
      }
    } catch (e) {
      showToast('测试失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      testing = false;
    }
  }

  onMount(load);
</script>

<svelte:head>
  <title>投递 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="body">
      <p class="intro">
        启用投递后，本机将作为纯粹的爬虫节点，新的数据将不会记录到本地数据库。
      </p>

      <section class="form-section">
        <h3 class="section-title">投递开关</h3>
        {#if loading}
          <p class="hint">加载中…</p>
        {:else}
          <label class="toggle-wrap">
            <input type="checkbox" bind:checked={enabled} />
            <span class="toggle-slider"></span>
            <span class="toggle-label">启用投递</span>
          </label>
        {/if}
      </section>

      <section class="form-section">
        <h3 class="section-title">投递目标 URL</h3>
        {#if loading}
          <p class="hint">加载中…</p>
        {:else}
          <input
            type="url"
            class="url-input"
            placeholder="https://other-server/api/gateway/items"
            bind:value={url}
          />
          <p class="hint">需同时开启开关并填写 URL 才生效。测试端点不写数据库，仅发送示例条目。</p>
        {/if}
      </section>

      <section class="form-section">
        <div class="btn-row">
          <button type="button" class="btn btn-primary" on:click={save} disabled={saving || loading}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" class="btn btn-secondary" on:click={test} disabled={testing || loading || !enabled || !url.trim()}>
            {testing ? '测试中…' : '测试投递'}
          </button>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .feed-wrap {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .feed-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .body::-webkit-scrollbar {
    width: 4px;
  }
  .body::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
  }
  .intro {
    color: #444;
    margin: 0 0 1.25rem;
    line-height: 1.5;
    font-size: 0.875rem;
  }
  .intro code {
    background: #f3f4f6;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .section-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #6b7280;
    margin: 0 0 0.5rem;
  }
  .form-section {
    margin-bottom: 1.25rem;
  }
  .url-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }
  .url-input::placeholder {
    color: #9ca3af;
  }
  .toggle-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  .toggle-wrap input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    width: 36px;
    height: 20px;
    background: #d1d5db;
    border-radius: 10px;
    transition: background 0.2s;
  }
  .toggle-slider::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    margin: 2px 0 0 2px;
    transition: transform 0.2s;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .toggle-wrap input:checked + .toggle-slider {
    background: #22c55e;
  }
  .toggle-wrap input:checked + .toggle-slider::after {
    transform: translateX(16px);
  }
  .toggle-label {
    font-size: 0.875rem;
  }
  .hint {
    font-size: 0.75rem;
    color: #9ca3af;
    margin: 0.5rem 0 0;
  }
  .btn-row {
    display: flex;
    gap: 0.75rem;
  }
  .btn {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }
  .btn-primary {
    background: #0969da;
    color: #fff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #0550ae;
  }
  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #e5e7eb;
  }
  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .feed-wrap {
      max-width: 100%;
    }
    .feed-col {
      border: none;
    }
  }
</style>
