<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';

  interface ApiItem {
    url: string;
    title: string | null;
    author?: string | null;
    summary?: string | null;
    pub_date?: string | null;
    fetched_at?: string;
    sub_id: string;
    sub_title: string;
  }

  interface FeedItem {
    link: string;
    title?: string;
    author?: string;
    summary?: string;
    pubDate?: string;
    _subId: string;
    _subTitle: string;
    _source: string;
  }

  const PAGE_SIZE = 20;

  let allItems: FeedItem[] = [];
  let channels: { id: string; title: string }[] = [];
  let loading = false;
  let loadingMore = false;
  let loadError = '';
  let hasMore = false;
  let currentOffset = 0;
  let pendingNewCount = 0;
  let showBadge = false;
  let badgeText = '';

  let listEl: HTMLElement | null = null;
  let showBackTop = false;
  let esRef: EventSource | null = null;

  // 当前激活的频道过滤（从 URL 参数读取）
  $: activeFilter = $page.params.sub === 'all' ? 'all' : ($page.params.sub ?? 'all');

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

  function extractSource(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function mapApiItem(item: ApiItem): FeedItem {
    return {
      link: item.url,
      title: item.title || undefined,
      author: item.author ?? undefined,
      summary: item.summary ?? undefined,
      pubDate: item.pub_date || item.fetched_at,
      _subId: item.sub_id,
      _subTitle: item.sub_title,
      _source: extractSource(item.url),
    };
  }

  function buildUrl(offset: number, filter: string): string {
    const sub = filter !== 'all' ? `&sub=${encodeURIComponent(filter)}` : '';
    return `/api/feed?limit=${PAGE_SIZE}&offset=${offset}${sub}`;
  }

  /** 初始加载 / 刷新：重置列表，从第一页开始 */
  async function loadFeed(filter: string, silent = false) {
    if (!silent) { loading = true; loadError = ''; }
    try {
      const res = await fetch(buildUrl(0, filter));
      const data: { channels: { id: string; title?: string }[]; items: ApiItem[]; hasMore: boolean } = await res.json();
      if (Array.isArray(data.channels)) {
        channels = data.channels.map((s) => ({ id: s.id, title: s.title || s.id }));
      }
      if (channels.length === 0) {
        allItems = [];
        loadError = '暂无频道，请在 <code>channels.json</code> 中配置';
        return;
      }
      allItems = (data.items || []).map(mapApiItem);
      hasMore = !!data.hasMore;
      currentOffset = allItems.length;
      hideBadge();
    } catch (err) {
      if (!silent) loadError = '加载失败: ' + (err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) loading = false;
    }
  }

  /** 滚动到底部时追加下一页 */
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const res = await fetch(buildUrl(currentOffset, activeFilter));
      const data: { items: ApiItem[]; hasMore: boolean } = await res.json();
      const newItems = (data.items || []).map(mapApiItem);
      allItems = [...allItems, ...newItems];
      hasMore = !!data.hasMore;
      currentOffset += newItems.length;
    } catch { /* 静默失败，用户可再次滚动触发 */ } finally {
      loadingMore = false;
    }
  }

  function showBadgeFn(count: number) {
    pendingNewCount += count;
    badgeText = '↑ ' + pendingNewCount + ' 条新内容';
    showBadge = true;
  }

  function hideBadge() { pendingNewCount = 0; showBadge = false; }
  function dismissBadge() { loadFeed(activeFilter, true); }

  function onListScroll() {
    showBackTop = (listEl?.scrollTop ?? 0) > 400;
  }

  function scrollToTop() {
    listEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function sentinelObserver(node: HTMLElement) {
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) loadMore();
      },
      { root: listEl, rootMargin: '0px 0px 300px 0px' }
    );
    obs.observe(node);
    return { destroy() { obs.disconnect(); } };
  }

  function connectSSE() {
    const es = new EventSource('/api/events');
    esRef = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'feed:updated') return;
        if (allItems.length === 0) { loadFeed(activeFilter, true); } else { showBadgeFn(msg.newCount); }
      } catch { /* ignore */ }
    };
    es.onerror = () => { es.close(); esRef = null; setTimeout(connectSSE, 5000); };
  }

  // 路由参数变化时重新加载
  let prevSub = '';
  $: {
    const sub = $page.params.sub ?? 'all';
    if (sub !== prevSub && prevSub !== '') {
      prevSub = sub;
      allItems = [];
      hasMore = false;
      currentOffset = 0;
      loadFeed(sub === 'all' ? 'all' : sub, false);
      listEl?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }

  onMount(() => {
    prevSub = $page.params.sub ?? 'all';
    loadFeed(prevSub === 'all' ? 'all' : prevSub, false);
    connectSSE();
  });

  onDestroy(() => {
    esRef?.close();
  });
</script>

<svelte:head>
  <title>信息流 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <h2>信息流</h2>
      <div class="feed-header-right">
        {#if showBadge}
          <button class="update-badge" on:click={dismissBadge}>{badgeText}</button>
        {/if}
      </div>
    </div>

    <!-- 频道过滤标签（链接式导航） -->
    <div class="filter-bar">
      <a
        class="filter-chip"
        class:active={activeFilter === 'all'}
        href="/all"
      >全部</a>
      {#each channels as ch}
        <a
          class="filter-chip"
          class:active={activeFilter === ch.id}
          href="/{ch.id}"
        >{ch.title}</a>
      {/each}
    </div>

    <!-- 条目列表 -->
    <div class="feed-list" bind:this={listEl} on:scroll={onListScroll}>
      {#if loading && allItems.length === 0}
        <div class="state">加载中…</div>
      {:else if loadError && allItems.length === 0}
        <div class="state">{@html loadError}</div>
      {:else if allItems.length === 0}
        <div class="state">
          {activeFilter === 'all'
            ? '暂无内容，请先在 channels.json 中配置频道'
            : '该频道暂无内容'}
        </div>
      {:else}
        {#each allItems as item (item.link)}
          <div class="item">
            {#if item.author}
              <div class="item-author-top">{item.author}</div>
            {/if}
            {#if item.title}
              <a class="item-title" href={item.link} target="_blank" rel="noopener">{item.title}</a>
            {/if}
            {#if item.summary}
              <p class="item-summary">{item.summary}</p>
            {/if}
            <div class="item-meta">
              <span class="item-source">{item._source}</span>
              <span class="item-dot"></span>
              <span>{relativeTime(item.pubDate)}</span>
            </div>
          </div>
        {/each}
        {#if hasMore}
          <div use:sentinelObserver></div>
        {/if}
        {#if loadingMore}
          <div class="load-more-state">加载更多…</div>
        {:else if !hasMore && allItems.length > 0}
          <div class="load-more-state">已加载全部 {allItems.length} 条</div>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if showBackTop}
  <button class="back-top" on:click={scrollToTop} aria-label="回到顶部">↑</button>
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
    justify-content: space-between;
    flex-shrink: 0;
  }
  .feed-header h2 { font-size: 0.9375rem; font-weight: 600; }
  .feed-header-right { display: flex; align-items: center; gap: 0.75rem; }

  .update-badge {
    font-size: 0.7rem;
    color: #fff;
    background: #0969da;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }

  .filter-bar {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .filter-bar::-webkit-scrollbar { display: none; }

  .filter-chip {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.75rem;
    cursor: pointer;
    border: 1px solid #e0e0e0;
    background: #fff;
    color: #555;
    white-space: nowrap;
    transition: all 0.15s;
    font-family: inherit;
    text-decoration: none;
  }
  .filter-chip:hover { border-color: #aaa; color: #111; }
  .filter-chip.active { background: #111; color: #fff; border-color: #111; }

  .feed-list { flex: 1; overflow-y: auto; }
  .feed-list::-webkit-scrollbar { width: 4px; }
  .feed-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .item {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #f3f3f3;
    transition: background 0.1s;
  }
  .item:hover { background: #fafafa; }
  .item-author-top {
    font-size: 0.75rem;
    font-weight: 500;
    color: #555;
    margin-bottom: 0.3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
  .item-source {
    max-width: 160px;
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
  .load-more-state {
    padding: 1.25rem;
    text-align: center;
    color: #ccc;
    font-size: 0.8rem;
  }

  .back-top {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: #111;
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    transition: background 0.15s, opacity 0.2s;
    z-index: 50;
  }
  .back-top:hover { background: #333; }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
