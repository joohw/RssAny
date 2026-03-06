<script lang="ts">
  import { page } from '$app/stores';

  /** 简单 Markdown 转 HTML（标题、列表、链接、加粗） */
  function mdToHtml(md: string): string {
    const lines = md.split('\n');
    let out = '';
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const isLi = t.startsWith('- ') || t.startsWith('* ') || /^\d+\.\s/.test(t);
      const liContent = isLi
        ? (t.startsWith('- ') || t.startsWith('* ') ? t.slice(2) : t.replace(/^\d+\.\s/, ''))
        : '';
      if (isLi) {
        if (!inList) {
          out += '<ul>';
          inList = true;
        }
        out += `<li>${inlineMd(liContent)}</li>`;
      } else {
        if (inList) {
          out += '</ul>';
          inList = false;
        }
        if (t.startsWith('### ')) out += `<h3>${escapeHtml(t.slice(4))}</h3>`;
        else if (t.startsWith('## ')) out += `<h2>${escapeHtml(t.slice(3))}</h2>`;
        else if (t.startsWith('# ')) out += `<h1>${escapeHtml(t.slice(2))}</h1>`;
        else if (t === '') out += '<br>';
        else out += `<p>${inlineMd(t)}</p>`;
      }
    }
    if (inList) out += '</ul>';
    return out;
  }
  function inlineMd(s: string): string {
    return escapeHtml(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, href) =>
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>`
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  let content = '';
  let loading = true;
  let error = '';
  let dateList: string[] = [];
  let lastLoadedDate = '';

  function isValidDate(s: string): boolean {
    if (!DATE_RE.test(s)) return false;
    const d = new Date(s);
    return !Number.isNaN(d.getTime());
  }

  function formatDateDisplay(s: string): string {
    const d = new Date(s);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  async function loadReport(date: string) {
    if (!isValidDate(date)) {
      error = '无效日期格式';
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      const [reportRes, datesRes] = await Promise.all([
        fetch(`/api/daily/${date}`),
        fetch('/api/daily/dates'),
      ]);
      const datesData = await datesRes.json();
      dateList = datesData.dates ?? [];

      if (!reportRes.ok) {
        const data = await reportRes.json().catch(() => ({}));
        if (reportRes.status === 404) {
          content = '';
          error = '当日暂无日报，可通过 AI（MCP）根据任务生成';
        } else {
          error = data.error ?? '加载失败';
        }
      } else {
        const data = await reportRes.json();
        content = data.content ?? '';
      }
    } catch (e) {
      error = '加载失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  $: routeDate = $page.params.date ?? '';
  $: if (routeDate && routeDate !== lastLoadedDate) {
    lastLoadedDate = routeDate;
    loadReport(routeDate);
  }
</script>

<svelte:head>
  <title>日报 {routeDate ? formatDateDisplay(routeDate) : ''} - RssAny</title>
</svelte:head>

<div class="daily-wrap">
  <div class="daily-header">
    <h2>日报</h2>
    <div class="daily-nav">
      <a href="/daily" on:click|stopPropagation>今日</a>
      {#if dateList.length > 0}
        <span class="sep">|</span>
        {#each dateList.slice(0, 10) as d}
          <a
            href="/daily/{d}"
            class:active={d === routeDate}
            on:click|stopPropagation
          >{d}</a>
        {/each}
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="state">加载中…</div>
  {:else if error}
    <div class="state error">{error}</div>
  {:else if content}
    <article class="daily-content markdown">
      {@html mdToHtml(content)}
    </article>
  {:else}
    <div class="state">
      <p>当日暂无日报。</p>
      <p class="hint">在 <code>.rssany/tasks/</code> 中创建任务（如 daily-report.md），通过 Cursor 等 AI 调用 MCP 工具生成日报并保存。</p>
    </div>
  {/if}
</div>

<style>
  .daily-wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }
  .daily-header {
    margin-bottom: 1.5rem;
  }
  .daily-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
  }
  .daily-nav {
    font-size: 0.875rem;
    color: #555;
  }
  .daily-nav a {
    color: #555;
    text-decoration: none;
    margin-right: 0.5rem;
  }
  .daily-nav a:hover { color: #111; }
  .daily-nav a.active { color: #111; font-weight: 500; }
  .daily-nav .sep { margin-right: 0.5rem; color: #999; }
  .state {
    color: #666;
    padding: 2rem;
    text-align: center;
  }
  .state.error { color: #c00; }
  .state .hint { font-size: 0.8125rem; margin-top: 1rem; color: #888; }
  .state code { background: #eee; padding: 0.1em 0.3em; border-radius: 3px; }
  .daily-content {
    font-size: 0.9375rem;
    line-height: 1.65;
  }
  .daily-content :global(h1) { font-size: 1.35rem; margin: 1.5rem 0 0.75rem; }
  .daily-content :global(h2) { font-size: 1.15rem; margin: 1.25rem 0 0.5rem; }
  .daily-content :global(h3) { font-size: 1rem; margin: 1rem 0 0.5rem; }
  .daily-content :global(p) { margin: 0.5rem 0; }
  .daily-content :global(ul) { margin: 0.5rem 0; padding-left: 1.5rem; }
  .daily-content :global(li) { margin: 0.25rem 0; }
  .daily-content :global(a) { color: #2563eb; }
  .daily-content :global(a:hover) { text-decoration: underline; }
  .daily-content :global(code) { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
</style>
