<script lang="ts">
  // Preview 页面：预览指定 URL 的 RSS 条目，支持轮询等待正文提取完成
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  interface FeedItem {
    title: string; link: string; summary?: string; author?: string;
    pubDate?: string; contentHtml?: string; extractionFailed?: boolean;
  }

  let feedUrl = '';
  let headlessParam: string | null = null;
  let items: FeedItem[] = [];
  let fromCache = false;
  let state: 'loading' | 'items' | 'error' = 'loading';
  let errorMsg = '';
  let errorHint = '';
  let extracting = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollCount = 0;
  const MAX_POLL = 20;
  let copied = false;

  $: rssUrl = feedUrl ? location.origin + '/rss/' + encodeURIComponent(feedUrl) : '';
  $: extractDone = items.filter((i) => i.contentHtml || i.extractionFailed).length;
  $: extractPct = items.length ? Math.round(extractDone / items.length * 100) : 100;
  $: showProgress = items.length > 0 && extractDone < items.length;

  function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function copyRss() {
    await navigator.clipboard.writeText(rssUrl);
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
  }

  async function load(manual = false) {
    if (pollTimer) clearTimeout(pollTimer);
    if (manual) { pollCount = 0; state = 'loading'; }
    const apiUrl = '/api/rss?url=' + encodeURIComponent(feedUrl) + (headlessParam ? '&headless=false' : '');
    try {
      const resp = await fetch(apiUrl);
      const data = await resp.json();
      if (!resp.ok) {
        errorMsg = data.code === 'AUTH_REQUIRED' ? '该站点需要登录' : (data.error || `HTTP ${resp.status}`);
        errorHint = data.code === 'AUTH_REQUIRED' ? '请先在「插件管理」页面完成认证' : (data.code || '');
        state = 'error';
        return;
      }
      fromCache = data.fromCache;
      items = data.items;
      extracting = items.some((i: FeedItem) => !i.contentHtml && !i.extractionFailed);
      state = 'items';
      if (extracting && pollCount < MAX_POLL) {
        pollCount++;
        pollTimer = setTimeout(() => load(false), 3000);
      } else {
        pollCount = 0;
      }
    } catch (e) {
      errorMsg = '请求失败';
      errorHint = e instanceof Error ? e.message : String(e);
      state = 'error';
    }
  }

  onMount(() => {
    const params = new URLSearchParams($page.url.search);
    feedUrl = params.get('url') || '';
    headlessParam = params.get('headless');
    if (feedUrl) {
      document.title = 'Preview – ' + new URL(feedUrl).hostname;
      load();
    } else {
      errorMsg = '缺少 url 参数';
      errorHint = '请在 URL 中提供 ?url=https://...';
      state = 'error';
    }
  });
</script>

<svelte:head><title>Preview - RssAny</title></svelte:head>

<div class="container">
  {#if feedUrl}
    <div class="feed-meta">
      <div class="feed-meta-info">
        <div class="feed-meta-url">{feedUrl}</div>
        <div class="feed-meta-status">
          {#if state === 'loading'}
            <span class="badge badge-loading">加载中…</span>
          {:else if state === 'items'}
            <span class="badge {fromCache ? 'badge-cache' : 'badge-live'}">{fromCache ? '缓存' : '实时抓取'}</span>
            {#if extracting}<span class="badge badge-extracting" style="margin-left:0.35rem">正在提取正文…</span>{/if}
          {/if}
        </div>
      </div>
      <div class="rss-actions">
        <a class="btn-rss" href={rssUrl} target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="3"/><path d="M4 6a16 16 0 0 1 16 16"/><path d="M4 11a11 11 0 0 1 11 11"/></svg>
          RSS
        </a>
        <button class="btn-copy" class:copied on:click={copyRss}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {copied ? '✓ 已复制' : '复制链接'}
        </button>
      </div>
    </div>
  {/if}

  {#if showProgress}
    <div class="progress-bar"><div class="progress-fill" style="width:{extractPct}%"></div></div>
  {/if}

  {#if state === 'loading'}
    <div class="loading-state"><div class="spinner"></div><div>正在加载…</div></div>
  {:else if state === 'error'}
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-msg">{errorMsg}</div>
      {#if errorHint}<div class="error-hint">{errorHint}</div>{/if}
      <button class="retry-btn" on:click={() => load(true)}>重试</button>
    </div>
  {:else}
    <div class="items-header">
      <span class="items-count">{items.length} 条</span>
      <button class="refresh-btn" on:click={() => load(true)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        刷新
      </button>
    </div>
    {#if items.length === 0}
      <div class="empty-state"><div class="empty-icon">📭</div><div>暂无条目</div></div>
    {:else}
      {#each items as item}
        {@const isExtracting = !item.contentHtml && !item.extractionFailed}
        <div class="item-card">
          <div class="item-title"><a href={item.link} target="_blank" rel="noopener">{item.title || '(无标题)'}</a></div>
          <div class="item-meta">
            {#if item.author}<span class="item-author">{item.author}</span>{/if}
            {#if item.author && (item.pubDate || isExtracting || item.extractionFailed)}<span class="item-dot">·</span>{/if}
            {#if item.pubDate}<span class="item-date">{formatDate(item.pubDate)}</span>{/if}
            {#if isExtracting}<span class="item-dot">·</span><span class="badge badge-extracting">提取中…</span>{/if}
            {#if item.extractionFailed}<span class="item-dot">·</span><span class="badge badge-error">提取失败</span>{/if}
          </div>
          {#if item.summary}<div class="item-summary">{item.summary}</div>{/if}
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .container { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem }
  .feed-meta { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.125rem 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.75rem }
  .feed-meta-info { flex: 1; min-width: 0 }
  .feed-meta-url { font-size: 0.8rem; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .feed-meta-status { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; margin-top: 0.3rem }
  .badge-loading { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd }
  .rss-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0 }
  .btn-copy { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.875rem; background: #111; color: #fff; border: none; border-radius: 7px; font-size: 0.8125rem; cursor: pointer; font-family: inherit; transition: background 0.15s; white-space: nowrap }
  .btn-copy:hover { background: #333 }
  .btn-copy.copied { background: #16a34a }
  .btn-rss { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.75rem; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; border-radius: 7px; font-size: 0.8125rem; cursor: pointer; text-decoration: none; font-family: inherit; transition: background 0.15s; white-space: nowrap }
  .btn-rss:hover { background: #ffedd5 }
  .loading-state { text-align: center; padding: 4rem 1rem; color: #999 }
  .spinner { width: 28px; height: 28px; border: 2px solid #e5e7eb; border-top-color: #111; border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 0.75rem }
  @keyframes spin { to { transform: rotate(360deg) } }
  .error-state { text-align: center; padding: 3rem 1rem }
  .error-icon { font-size: 2rem; margin-bottom: 0.75rem }
  .error-msg { color: #b91c1c; font-size: 0.9375rem; margin-bottom: 1rem }
  .error-hint { color: #888; font-size: 0.8rem }
  .retry-btn { margin-top: 1.25rem; padding: 0.5rem 1.25rem; background: #111; color: #fff; border: none; border-radius: 7px; cursor: pointer; font-family: inherit; font-size: 0.875rem }
  .progress-bar { height: 2px; background: #e5e7eb; border-radius: 1px; margin-bottom: 1.25rem; overflow: hidden }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #111 0%, #555 100%); border-radius: 1px; transition: width 0.4s ease }
  .items-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.875rem }
  .items-count { font-size: 0.8rem; color: #999 }
  .refresh-btn { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; color: #666; background: none; border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; font-family: inherit; transition: all 0.15s }
  .refresh-btn:hover { color: #111; border-color: #aaa }
  .item-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.625rem; transition: border-color 0.15s }
  .item-card:hover { border-color: #bbb }
  .item-title { font-size: 0.9375rem; font-weight: 600; line-height: 1.45; margin-bottom: 0.35rem }
  .item-title a { color: #111; text-decoration: none }
  .item-title a:hover { text-decoration: underline }
  .item-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem }
  .item-author { font-size: 0.775rem; color: #666 }
  .item-date { font-size: 0.775rem; color: #aaa }
  .item-dot { color: #ddd; font-size: 0.7rem }
  .item-summary { font-size: 0.8375rem; color: #666; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
  .empty-state { text-align: center; padding: 3rem 1rem; color: #aaa }
  .empty-icon { font-size: 2rem; margin-bottom: 0.5rem }
  @media (max-width: 600px) { .container { padding: 1rem 0.875rem 3rem } .feed-meta { flex-direction: column; align-items: flex-start } .rss-actions { width: 100%; justify-content: flex-end } }
</style>
