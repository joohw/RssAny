<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { marked } from 'marked';
  import { fetchJson } from '$lib/fetchJson.js';
  import { peekSandboxFileRel, stashSandboxFolderRel } from '$lib/sandboxFileNav.js';

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

  function resolveEntryPath(): string {
    if (!browser) return '';
    return peekSandboxFileRel().trim();
  }

  /** 仅来自 sessionStorage（从 /folders 打开） */
  let filePath = resolveEntryPath();

  let html = '';
  let loading = false;
  let loadError = '';

  afterNavigate(({ to }) => {
    if (to?.url.pathname !== '/folders/file') return;
    const next = peekSandboxFileRel().trim();
    if (next !== filePath) filePath = next;
  });

  function goFolder(rel: string): void {
    stashSandboxFolderRel(rel);
    goto('/folders', { replaceState: true, noScroll: true });
  }

  async function loadFile(rel: string) {
    if (!rel || !rel.toLowerCase().endsWith('.md')) {
      loadError = '请指定沙盒内的 .md 路径';
      loading = false;
      html = '';
      return;
    }
    loading = true;
    loadError = '';
    html = '';
    try {
      const data = await fetchJson<{ content?: string; error?: string }>(
        `/api/sandbox-file?rel=${encodeURIComponent(rel)}`
      );
      if (data?.error) throw new Error(data.error);
      const raw = data?.content ?? '';
      html = processMarkdownHtml(marked.parse(preprocessTableMarkdown(raw)) as string);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $: if (filePath) {
    void loadFile(filePath);
  } else {
    loading = false;
    loadError = '';
    html = '';
  }
</script>

<svelte:head>
  <title>{filePath || '文件'} - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <nav class="crumb-bar" aria-label="路径">
      <div class="crumb">
        <a
          href="/folders"
          class="crumb-link"
          on:click={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            goFolder('');
          }}>根目录</a>
        {#each filePath.split('/').filter(Boolean) as seg, i}
          {@const prefix = filePath.split('/').filter(Boolean).slice(0, i + 1).join('/')}
          {@const isLast = i === filePath.split('/').filter(Boolean).length - 1}
          <span class="crumb-sep">/</span>
          {#if isLast}
            <span class="crumb-current">{seg}</span>
          {:else}
            <a
              href="/folders"
              class="crumb-link"
              on:click={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                goFolder(prefix);
              }}>{seg}</a>
          {/if}
        {/each}
      </div>
    </nav>

    <div class="body">
      {#if !filePath}
        <div class="state">请在「文件夹」中打开 Markdown 文件</div>
      {:else if loading}
        <div class="state">加载中…</div>
      {:else if loadError}
        <div class="state err">{loadError}</div>
      {:else}
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
    padding: 0.95rem 1.25rem 1rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .crumb {
    font-size: 0.9375rem;
    line-height: 1.45;
    font-weight: 500;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.35rem;
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
  .crumb-current {
    color: #111;
    font-weight: 600;
    word-break: break-all;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.25rem 3rem;
  }
  .body::-webkit-scrollbar { width: 4px; }
  .body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .state {
    padding: 2rem;
    text-align: center;
    color: #888;
    font-size: 0.875rem;
  }
  .state.err { color: #c53030; }

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
  .markdown-body :global(p) { margin: 0.6rem 0; color: #444; }
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
  .markdown-body :global(li) { margin: 0.25rem 0; color: #444; }
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
