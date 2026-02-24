<script lang="ts">
  import { onMount } from 'svelte';

  let content = '';
  let original = '';
  let error = '';
  let saveMsg = '';
  let loading = true;
  let saving = false;

  // 实时 JSON 格式检查
  $: {
    if (content.trim() === '') {
      error = '';
    } else {
      try {
        JSON.parse(content);
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  $: dirty = content !== original;
  $: canSave = !error && dirty && !saving;

  async function load() {
    loading = true;
    try {
      const res = await fetch('/api/subscriptions/raw');
      const text = await res.text();
      // 格式化输出
      content = JSON.stringify(JSON.parse(text), null, 2);
      original = content;
    } catch (e) {
      content = '{}';
      original = content;
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    saveMsg = '';
    try {
      const res = await fetch('/api/subscriptions/raw', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      });
      const result = await res.json();
      if (!result.ok) throw new Error(result.message || '保存失败');
      original = content;
      saveMsg = '已保存';
      setTimeout(() => { saveMsg = ''; }, 2500);
    } catch (e) {
      saveMsg = '保存失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
    }
  }

  function format() {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2);
    } catch { /* 有错误时不格式化 */ }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Tab 键插入两个空格
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      content = content.slice(0, start) + '  ' + content.slice(end);
      // 下一帧恢复光标位置
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    // Cmd/Ctrl + S 保存
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }

  onMount(load);
</script>

<svelte:head>
  <title>订阅管理 - RssAny</title>
</svelte:head>

<div class="container">
  <div class="page-header">
    <div>
      <h1>订阅管理</h1>
      <p class="page-desc">
        直接编辑 <code>.rssany/subscriptions.json</code> 文件内容，支持实时 JSON 格式检查
      </p>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" on:click={format} disabled={!!error || loading}>
        格式化
      </button>
      <button class="btn btn-primary" on:click={save} disabled={!canSave}>
        {saving ? '保存中…' : '保存'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="state">加载中…</div>
  {:else}
    <div class="editor-wrap" class:has-error={!!error}>
      <textarea
        class="editor"
        bind:value={content}
        on:keydown={handleKeydown}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      ></textarea>
    </div>

    <div class="footer">
      {#if error}
        <span class="msg error">✗ {error}</span>
      {:else if saveMsg}
        <span class="msg {saveMsg.startsWith('保存失败') ? 'error' : 'success'}">{saveMsg.startsWith('保存失败') ? '✗' : '✓'} {saveMsg}</span>
      {:else if dirty}
        <span class="msg hint">未保存的更改 · Cmd/Ctrl+S 快速保存</span>
      {:else}
        <span class="msg hint">已同步</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 48px);
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-shrink: 0;
  }
  .page-header h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.2rem; }
  .page-desc { font-size: 0.8rem; color: #888; }
  .page-desc code { background: #f0f0f0; padding: 0.1rem 0.35rem; border-radius: 3px; font-family: monospace; }

  .header-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 0.45rem 1rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-primary { background: #111; color: #fff; }
  .btn-primary:hover:not(:disabled) { background: #333; }
  .btn-secondary { background: #f0f0f0; color: #333; }
  .btn-secondary:hover:not(:disabled) { background: #e0e0e0; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .editor-wrap {
    flex: 1;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    transition: border-color 0.15s;
    min-height: 0;
  }
  .editor-wrap.has-error { border-color: #e53e3e; }

  .editor {
    width: 100%;
    height: 100%;
    padding: 1rem 1.25rem;
    border: none;
    outline: none;
    resize: none;
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
    color: #222;
    background: transparent;
    tab-size: 2;
  }

  .footer {
    flex-shrink: 0;
    padding: 0.5rem 0.25rem;
    min-height: 1.75rem;
  }

  .msg {
    font-size: 0.775rem;
  }
  .msg.error { color: #e53e3e; }
  .msg.success { color: #1a7f37; }
  .msg.hint { color: #bbb; }

  .state {
    text-align: center;
    padding: 4rem;
    color: #aaa;
    font-size: 0.875rem;
  }
</style>
