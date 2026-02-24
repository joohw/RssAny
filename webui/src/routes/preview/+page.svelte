<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';

  interface FeedItem {
    guid?: string;
    title?: string;
    link: string;
    summary?: string;
    author?: string;
    pubDate?: string;
  }

  let feedUrl = '';
  let headlessParam: string | null = null;
  let items: FeedItem[] = [];
  let loading = false;
  let loadError = '';
  let toast = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // 当前进行中的 fetch 的 AbortController，用于在导航离开时主动取消请求
  let abortController: AbortController | null = null;

  let rssUrl = '';
  $: if (feedUrl) rssUrl = location.origin + '/rss/' + feedUrl;

  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; }, 2500);
  }

  function relativeTime(dateStr?: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function normalizeItems(raw: unknown): FeedItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry): FeedItem | null => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const link = typeof item.link === 'string' ? item.link.trim() : '';
        if (!link) return null;
        return {
          guid: typeof item.guid === 'string' ? item.guid : undefined,
          title: typeof item.title === 'string' && item.title.trim() ? item.title : '(无标题)',
          link,
          summary: typeof item.summary === 'string' ? item.summary : undefined,
          author: typeof item.author === 'string' ? item.author : undefined,
          pubDate: typeof item.pubDate === 'string' ? item.pubDate : undefined,
        };
      })
      .filter((item): item is FeedItem => item != null);
  }

  /** 取消当前正在进行的 fetch 请求 */
  function abortLoad() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  async function load(manual = false) {
    // 先取消上一个还在进行的请求
    abortLoad();

    if (manual) {
      loading = true;
      loadError = '';
      items = [];
    }

    const controller = new AbortController();
    abortController = controller;
    const timeoutMs = 30000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const apiUrl = '/api/rss?url=' + encodeURIComponent(feedUrl) + (headlessParam ? '&headless=false' : '');
    try {
      const resp = await fetch(apiUrl, { signal: controller.signal });
      const data = await resp.json();
      if (!resp.ok) {
        loadError = data.code === 'AUTH_REQUIRED'
          ? '该站点需要登录，请先在「插件管理」页面完成认证'
          : (data.error || `请求失败 HTTP ${resp.status}`);
        return;
      }
      items = normalizeItems(data.items);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (timedOut) loadError = `请求超时（${timeoutMs / 1000}s），请重试或检查代理/登录状态`;
        return;
      }
      loadError = '请求失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timeoutId);
      // 仅在此 controller 未被替换时才清除 loading 状态
      if (abortController === controller) {
        abortController = null;
        loading = false;
      }
    }
  }

  async function copyRss() {
    const url = location.origin + '/rss/' + feedUrl;
    await navigator.clipboard.writeText(url);
    showToast('✓ RSS 链接已复制');
  }

  // 导航离开前主动取消请求，释放 HTTP 连接，确保 SvelteKit 路由切换不被阻塞
  beforeNavigate(() => {
    abortLoad();
  });

  // 组件销毁时也取消（双重保险）
  onDestroy(() => {
    abortLoad();
    if (toastTimer) clearTimeout(toastTimer);
  });

  onMount(() => {
    const params = new URLSearchParams(location.search);
    feedUrl = params.get('url') || '';
    headlessParam = params.get('headless');
    if (feedUrl) {
      document.title = 'Preview – ' + new URL(feedUrl).hostname;
      load(true);
    }
  });
</script>

<svelte:head>
  <title>Preview - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <div class="feed-header-url" title={feedUrl}>{feedUrl || '缺少 url 参数'}</div>
      <div class="feed-header-actions">
        <button
          class="refresh-btn"
          class:loading
          disabled={loading}
          on:click={() => load(true)}
        >↺ {loading ? '加载中…' : '刷新'}</button>
        {#if feedUrl}
          <a class="btn-rss" href={rssUrl} target="_blank" rel="noopener">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="18" r="3"/><path d="M4 6a16 16 0 0 1 16 16"/><path d="M4 11a11 11 0 0 1 11 11"/>
            </svg>
            RSS
          </a>
          <button class="btn-copy" on:click={copyRss}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制
          </button>
        {/if}
      </div>
    </div>

    <div class="feed-list">
      {#if !feedUrl}
        <div class="state">缺少 url 参数，请在 URL 中提供 ?url=https://…</div>
      {:else if loading && items.length === 0}
        <div class="state">加载中…</div>
      {:else if loadError && items.length === 0}
        <div class="state">{loadError}</div>
      {:else if items.length === 0}
        <div class="state">暂无条目</div>
      {:else}
        {#each items as item, idx ((item.guid || item.link || String(idx)) + ':' + idx)}
          <div class="item">
            <a class="item-title" href={item.link} target="_blank" rel="noopener">{item.title || '(无标题)'}</a>
            {#if item.summary}
              <p class="item-summary">{item.summary}</p>
            {/if}
            <div class="item-meta">
              {#if item.author}
                <span class="item-author">{item.author}</span>
                <span class="item-dot"></span>
              {/if}
              <span>{relativeTime(item.pubDate)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

{#if toast}
  <div class="toast">{toast}</div>
{/if}

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

  .feed-header {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  .feed-header-url {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .feed-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .refresh-btn {
    font-size: 0.75rem;
    color: #888;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: inherit;
  }
  .refresh-btn:hover { color: #111; background: #f5f5f5; }
  .refresh-btn.loading { opacity: 0.5; pointer-events: none; }

  .btn-copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.775rem;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-copy:hover { background: #333; }

  .toast {
    position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
    background: #16a34a; color: #fff; padding: 0.625rem 1.25rem; border-radius: 8px;
    font-size: 0.875rem; z-index: 100; white-space: nowrap; pointer-events: none;
  }

  .btn-rss {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    background: none;
    color: #888;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 0.775rem;
    cursor: pointer;
    text-decoration: none;
    font-family: inherit;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .btn-rss:hover { color: #111; border-color: #aaa; }

  .feed-list { flex: 1; overflow-y: auto; }
  .feed-list::-webkit-scrollbar { width: 4px; }
  .feed-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .item {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #f3f3f3;
    transition: background 0.1s;
  }
  .item:hover { background: #fafafa; }
  .item-title {
    font-size: 0.9rem;
    font-weight: 500;
    color: #111;
    text-decoration: none;
    display: block;
    line-height: 1.45;
    margin-bottom: 0.3rem;
  }
  .item-title:hover { color: #0969da; }
  .item-summary {
    font-size: 0.8rem;
    color: #666;
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 0.4rem;
  }
  .item-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.725rem;
    color: #bbb;
  }
  .item-author {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-dot {
    width: 2px;
    height: 2px;
    background: #ccc;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .state {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #aaa;
    font-size: 0.875rem;
    line-height: 1.7;
  }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
