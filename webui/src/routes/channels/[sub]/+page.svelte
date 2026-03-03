<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  interface ApiItem {
    url: string;
    source_url?: string;
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
    _sourceRef?: string;
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
  $: todayOnly = $page.url.searchParams.get('today') === '1';

  function todayStr(): string {
    return new Date().toLocaleDateString('en-CA');
  }

  function channelHref(sub: string, withToday = todayOnly): string {
    const base = `/channels/${sub}`;
    return withToday ? `${base}?today=1` : base;
  }

  function toggleToday() {
    goto(channelHref(activeFilter, !todayOnly), { replaceState: false });
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
      author: Array.isArray(item.author) ? item.author.join(', ') : (item.author ?? undefined),
      summary: item.summary ?? undefined,
      pubDate: item.pub_date || item.fetched_at,
      _subId: item.sub_id,
      _subTitle: item.sub_title,
      _source: extractSource(item.source_url || item.url),
      _sourceRef: item.source_url,
    };
  }

  function feedsUrl(offset: number, filter: string): string {
    const channelId = filter === 'all' ? 'all' : filter;
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (todayOnly) {
      const d = todayStr();
      params.set('since', d);
      params.set('until', d);
    }
    return `/api/channels/${encodeURIComponent(channelId)}/feeds?${params.toString()}`;
  }

  /** 加载频道列表（仅首次或刷新时） */
  async function loadChannels(): Promise<void> {
    try {
      const res = await fetch('/api/channels');
      const list: { id: string; title?: string }[] = await res.json();
      channels = Array.isArray(list) ? list.map((s) => ({ id: s.id, title: s.title || s.id })) : [];
    } catch {
      channels = [];
    }
  }

  /** 初始加载 / 刷新：频道取一次，feeds 按 channel 单独请求 */
  async function loadFeed(filter: string, silent = false) {
    if (!silent) { loading = true; loadError = ''; }
    try {
      if (channels.length === 0) await loadChannels();
      if (channels.length === 0) {
        allItems = [];
        loadError = '暂无频道，请在 <code>channels.json</code> 中配置';
        return;
      }
      const res = await fetch(feedsUrl(0, filter));
      const data: { items: ApiItem[]; hasMore: boolean } = await res.json();
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
      const res = await fetch(feedsUrl(currentOffset, activeFilter));
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

  function filterBarWheelAction(node: HTMLElement) {
    const handler = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    node.addEventListener('wheel', handler, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', handler);
      },
    };
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

  // 路由参数变化时重新加载（频道或今日筛选）
  let prevUrlKey = '';
  $: urlKey = `${$page.params.sub ?? 'all'}|${$page.url.searchParams.get('today') ?? ''}`;
  $: if (urlKey && urlKey !== prevUrlKey) {
    prevUrlKey = urlKey;
    const sub = $page.params.sub ?? 'all';
    allItems = [];
    hasMore = false;
    currentOffset = 0;
    loadFeed(sub === 'all' ? 'all' : sub, false);
    listEl?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  onMount(() => {
    connectSSE();
  });

  onDestroy(() => {
    esRef?.close();
  });
</script>

<svelte:head>
  <title>RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <!-- 频道 + 筛选方式 一行 -->
    <div class="filter-bar" use:filterBarWheelAction role="region" aria-label="频道筛选">
      <a
        class="filter-chip"
        class:active={activeFilter === 'all'}
        href={channelHref('all')}
      >全部</a>
      {#each channels as ch}
        <a
          class="filter-chip"
          class:active={activeFilter === ch.id}
          href={channelHref(ch.id)}
        >{ch.title}</a>
      {/each}
      <div class="filter-bar-spacer"></div>
      <button
        type="button"
        class="today-switch"
        class:active={todayOnly}
        on:click={toggleToday}
        title="只看今日发布的条目"
        aria-pressed={todayOnly}
      >
        <span class="today-switch-track">
          <span class="today-switch-thumb"></span>
        </span>
        <span class="today-switch-label">只看今日</span>
      </button>
      {#if showBadge}
        <button class="update-badge" on:click={dismissBadge}>{badgeText}</button>
      {/if}
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
              {#if item._sourceRef}
                <a class="item-source" href="/preview?url={encodeURIComponent(item._sourceRef)}" title="预览该信源">{item._source}</a>
              {:else}
                <span class="item-source">{item._source}</span>
              {/if}
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

  .filter-bar-spacer {
    flex: 1;
    min-width: 0.5rem;
  }

  .today-switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: #555;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0;
    font-family: inherit;
    flex-shrink: 0;
  }
  .today-switch:hover .today-switch-label { color: #111; }
  .today-switch-track {
    width: 2.25rem;
    height: 1.25rem;
    background: #e0e0e0;
    border-radius: 999px;
    position: relative;
    transition: background 0.2s;
  }
  .today-switch.active .today-switch-track { background: #0969da; }
  .today-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 1rem;
    height: 1rem;
    background: #fff;
    border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
    transition: transform 0.2s;
  }
  .today-switch.active .today-switch-thumb { transform: translateX(1rem); }
  .today-switch-label { white-space: nowrap; }

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
    align-items: center;
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
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  a.item-source:hover {
    color: #0969da;
    text-decoration: underline;
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
