<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';

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

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function prevDate(date: string): string {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function nextDate(date: string): string {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  let date = todayStr();
  let content: string | null = null;
  let html = '';
  let loading = true;
  let loadError = '';
  let generating = false;
  let generateError = '';

  async function load(targetDate: string) {
    loading = true;
    loadError = '';
    content = null;
    html = '';
    try {
      const res = await fetch(`/api/daily?date=${targetDate}`);
      const data = await res.json() as { date: string; content: string | null; exists: boolean };
      content = data.content;
      html = content ? processMarkdownHtml(marked.parse(preprocessTableMarkdown(content)) as string) : '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function generate(force = false) {
    generating = true;
    generateError = '';
    try {
      const res = await fetch('/api/daily/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, force }),
      });
      const data = await res.json() as { skipped?: boolean; error?: string };
      if (data.error) {
        generateError = data.error;
      } else {
        await load(date);
      }
    } catch (e) {
      generateError = e instanceof Error ? e.message : String(e);
    } finally {
      generating = false;
    }
  }

  function goDate(newDate: string) {
    const today = todayStr();
    if (newDate > today) return;
    date = newDate;
    load(date);
  }

  onMount(() => load(date));
</script>

<svelte:head>
  <title>日报 - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="header">
      <div class="header-left">
        <h2>日报</h2>
        <div class="date-nav">
          <button type="button" class="nav-btn" on:click|stopPropagation={() => goDate(prevDate(date))} title="前一天">‹</button>
          <span class="date-label">{date}</span>
          <button type="button" class="nav-btn" on:click|stopPropagation={() => goDate(nextDate(date))} disabled={date >= todayStr()} title="后一天">›</button>
        </div>
      </div>
      <div class="header-actions">
        {#if !loading && !content}
          <button class="gen-btn" on:click={() => generate(false)} disabled={generating}>
            {generating ? '生成中…' : '生成日报'}
          </button>
        {:else if !loading && content}
          <button class="gen-btn secondary" on:click={() => generate(true)} disabled={generating}>
            {generating ? '生成中…' : '重新生成'}
          </button>
        {/if}
      </div>
    </div>

    <div class="body">
      {#if loading}
        <div class="state">加载中…</div>
      {:else if loadError}
        <div class="state error">{loadError}</div>
      {:else if !content}
        <div class="state empty">
          <p>{date} 尚无日报</p>
          <p class="hint">点击「生成日报」让 AI 整理当日文章</p>
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
  }

  .header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
    white-space: nowrap;
  }

  .date-nav {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .nav-btn {
    background: none;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.12s;
  }
  .nav-btn:hover:not(:disabled) { background: #f3f4f6; }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }

  .date-label {
    font-size: 0.8125rem;
    color: #555;
    min-width: 88px;
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
  .gen-btn.secondary {
    background: none;
    color: #555;
    border-color: #d1d5db;
  }
  .gen-btn.secondary:hover:not(:disabled) { background: #f3f4f6; }

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

  /* Markdown 渲染样式 */
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
