<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto, beforeNavigate } from '$app/navigation';
  import FeedCard from '$lib/components/ui/FeedCard.svelte';
  import TagSelectDialog from '$lib/components/ui/TagSelectDialog.svelte';

  interface FeedItem {
    guid?: string;
    title?: string;
    link: string;
    summary?: string;
    author?: string;
    pubDate?: string;
    _source?: string;
    _sourceRef?: string;
  }

  const PAGE_SIZE = 20;

  function extractSource(url: string): string {
    try {
      return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /** 从当前 URL 解析的筛选参数；days=1 表示只看今日，days=N 表示最近 N 天 */
  let filters: { channel?: string; url?: string; author?: string; search?: string; tags?: string; days?: number } = {};
  let items: FeedItem[] = [];
  let currentOffset = 0;
  let hasMore = false;
  let total = 0;
  let loading = false;
  let loadingMore = false;
  let loadError = '';
  let listEl: HTMLElement | null = null;
  let showBackTop = false;

  let abortController: AbortController | null = null;

  /** RSS 地址（带查询参数） */
  $: rssUrl = (() => {
    const p = new URLSearchParams();
    if (filters.channel) p.set('channel', filters.channel);
    if (filters.url) p.set('sourceUrl', filters.url);
    if (filters.author) p.set('author', filters.author);
    if (filters.search) p.set('search', filters.search);
    if (filters.tags) p.set('tags', filters.tags);
    if (filters.days) p.set('days', String(filters.days));
    const qs = p.toString();
    return qs ? location.origin + '/rss?' + qs : '';
  })();

  $: hasFilters = !!(filters.channel || filters.url || filters.author || filters.search || filters.tags);

  let channels: { id: string; title: string }[] = [];

  /** 始终预加载频道列表（用于混合筛选） */
  $: if (channels.length === 0 && typeof window !== 'undefined') {
    fetch('/api/channels').then((r) => r.json()).then((list: { id: string; title?: string }[]) => {
      channels = Array.isArray(list) ? list.map((s) => ({ id: s.id, title: s.title || s.id })) : [];
    });
  }

  function toggleToday() {
    const ch = filters.channel || 'all';
    goto(feedsHref(ch, filters.days ? undefined : 1), { replaceState: false });
  }

  function apiUrl(offset: number): string {
    const p = new URLSearchParams();
    if (filters.channel) p.set('channel', filters.channel);
    if (filters.url) p.set('source', filters.url);
    if (filters.author) p.set('author', filters.author);
    if (filters.search) p.set('q', filters.search);
    if (filters.tags) p.set('tags', filters.tags);
    if (filters.days) p.set('days', String(filters.days));
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(offset));
    return '/api/items?' + p.toString();
  }

  /** 切换频道链接，保留其他筛选参数以支持混合筛选；overrides 可覆盖 url/author/tags */
  function feedsHref(ch: string, withDays?: number, overrides?: { url?: string; author?: string; tags?: string }): string {
    const p = new URLSearchParams();
    p.set('channel', ch);
    const url = overrides?.url ?? filters.url;
    const author = overrides?.author ?? filters.author;
    const tagsVal = overrides?.tags ?? filters.tags;
    if (url) p.set('url', url);
    if (author) p.set('author', author);
    if (filters.search) p.set('search', filters.search);
    if (tagsVal) p.set('tags', tagsVal);
    const daysVal = withDays ?? filters.days;
    if (daysVal) p.set('days', String(daysVal));
    return '/feeds?' + p.toString();
  }

  let showTagDialog = false;

  function onTagSelect(tag: string) {
    goto(feedsHref(filters.channel || 'all', undefined, { tags: tag }), { replaceState: false });
  }

  /** 移除指定筛选后的 URL（用于取消筛选） */
  function clearFilterHref(omit: 'url' | 'author' | 'search' | 'tags'): string {
    const p = new URLSearchParams();
    p.set('channel', filters.channel || 'all');
    if (omit !== 'url' && filters.url) p.set('url', filters.url);
    if (omit !== 'author' && filters.author) p.set('author', filters.author);
    if (omit !== 'search' && filters.search) p.set('search', filters.search);
    if (omit !== 'tags' && filters.tags) p.set('tags', filters.tags);
    if (filters.days) p.set('days', String(filters.days));
    return '/feeds?' + p.toString();
  }

  function mapDbItems(raw: unknown): FeedItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry): FeedItem | null => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const link = typeof item.url === 'string' ? item.url.trim() : '';
        if (!link) return null;
        const sourceUrl = typeof item.source_url === 'string' ? item.source_url : undefined;
        return {
          guid: typeof item.id === 'string' ? item.id : undefined,
          title: typeof item.title === 'string' && item.title.trim() ? item.title : '(无标题)',
          link,
          summary: typeof item.summary === 'string' ? item.summary : undefined,
          author: Array.isArray(item.author) ? item.author.join(', ') : (typeof item.author === 'string' ? item.author : undefined),
          pubDate: typeof item.pub_date === 'string' ? item.pub_date : undefined,
          _source: sourceUrl ? extractSource(sourceUrl) : undefined,
          _sourceRef: sourceUrl,
        };
      })
      .filter((item): item is FeedItem => item != null);
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const res = await fetch(apiUrl(currentOffset));
      const data = await res.json();
      const newItems = mapDbItems(data.items);
      items = [...items, ...newItems];
      hasMore = !!data.hasMore;
      total = data.total ?? total;
      currentOffset += newItems.length;
    } catch { /* 静默失败，用户可再次滚动触发 */ } finally {
      loadingMore = false;
    }
  }

  function onListScroll() {
    showBackTop = (listEl?.scrollTop ?? 0) > 400;
  }

  function scrollToTop() {
    listEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDeleteItem(id: string) {
    if (!confirm('确定删除此条目？')) return;
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || '删除失败');
        return;
      }
      items = items.filter((it) => (it.guid || it.link) !== id);
      total = Math.max(0, total - 1);
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : String(e)));
    }
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

  function abortLoad() {
    if (abortController) { abortController.abort(); abortController = null; }
  }

  async function load(manual = false) {
    abortLoad();
    if (manual) {
      loading = true;
      loadError = '';
      items = [];
      currentOffset = 0;
      hasMore = false;
      total = 0;
    }
    const controller = new AbortController();
    abortController = controller;
    try {
      const resp = await fetch(apiUrl(0), { signal: controller.signal });
      const data = await resp.json();
      if (!resp.ok) {
        loadError = data.error || `请求失败 HTTP ${resp.status}`;
        return;
      }
      items = mapDbItems(data.items);
      hasMore = !!data.hasMore;
      total = data.total ?? items.length;
      currentOffset = items.length;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      loadError = '请求失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      if (abortController === controller) { abortController = null; loading = false; }
    }
  }

  beforeNavigate(() => { abortLoad(); });
  onDestroy(() => { abortLoad(); });

  /** URL 变化时重新解析参数并加载（仅依赖 $page，避免与 filters 循环依赖） */
  $: pageUrl = $page.url;
  $: if (typeof window !== 'undefined' && pageUrl) {
    const params = pageUrl.searchParams;
    const daysVal = params.get('days');
    const next = {
      channel: params.get('channel') || undefined,
      url: params.get('url') || params.get('sourceUrl') || undefined,
      author: params.get('author') || undefined,
      search: params.get('search') || params.get('q') || undefined,
      tags: params.get('tags') || undefined,
      days: daysVal ? Math.max(1, Math.min(365, Number(daysVal) || 1)) : undefined,
    };
    const hasAny = !!(next.channel || next.url || next.author || next.search || next.tags);
    const changed =
      filters.channel !== next.channel ||
      filters.url !== next.url ||
      filters.author !== next.author ||
      filters.search !== next.search ||
      filters.tags !== next.tags ||
      filters.days !== next.days;
    filters = next;
    if (changed && hasAny) {
      const parts: string[] = [];
      if (next.channel) parts.push('频道: ' + (next.channel === 'all' ? '全部' : next.channel));
      if (next.url) parts.push('信源: ' + extractSource(next.url));
      if (next.author) parts.push('作者: ' + next.author);
      if (next.search) parts.push('搜索: ' + next.search);
      if (next.tags) parts.push('标签: ' + next.tags);
      if (next.days) parts.push(next.days === 1 ? '今日' : `近${next.days}天`);
      document.title = 'Feeds – ' + parts.join(' · ');
      load(true);
    }
  }

</script>

<svelte:head>
  <title>Feeds - RssAny</title>
</svelte:head>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && showTagDialog) showTagDialog = false; }} />

<div class="feed-wrap">
  <div class="feed-col">
    {#if filters.channel || channels.length > 0 || filters.url || filters.author || filters.search || filters.tags}
      <div class="feed-filter-bar">
        {#if channels.length > 0}
          <div class="filter-chips">
            <a class="filter-chip" class:active={filters.channel === 'all'} href={feedsHref('all', filters.days)}>全部</a>
            {#each channels as ch}
              <a class="filter-chip" class:active={filters.channel === ch.id} href={feedsHref(ch.id, filters.days)}>{ch.title}</a>
            {/each}
          </div>
        {/if}
        {#if filters.url || filters.author || filters.search || filters.tags}
          <div class="filter-tags">
            {#if filters.url}
              <a class="filter-tag" href={clearFilterHref('url')} title="取消信源筛选">
                <span>信源: {extractSource(filters.url)}</span>
                <span class="filter-tag-x">×</span>
              </a>
            {/if}
            {#if filters.author}
              <a class="filter-tag" href={clearFilterHref('author')} title="取消作者筛选">
                <span>作者: {filters.author}</span>
                <span class="filter-tag-x">×</span>
              </a>
            {/if}
            {#if filters.search}
              <a class="filter-tag" href={clearFilterHref('search')} title="取消搜索筛选">
                <span>搜索: {filters.search}</span>
                <span class="filter-tag-x">×</span>
              </a>
            {/if}
            {#if filters.tags}
              <a class="filter-tag" href={clearFilterHref('tags')} title="取消标签筛选">
                <span>标签: {filters.tags}</span>
                <span class="filter-tag-x">×</span>
              </a>
            {/if}
          </div>
        {/if}
        <button type="button" class="filter-tag-btn" on:click={() => (showTagDialog = true)} title="选择标签筛选">
          标签
        </button>
        <label class="filter-today">
          <input type="checkbox" checked={!!filters.days} on:change={toggleToday} />
          只看今日
        </label>
      </div>
    {/if}

    <TagSelectDialog
      open={showTagDialog}
      onClose={() => (showTagDialog = false)}
      onSelect={onTagSelect}
    />

    <div class="feed-list" bind:this={listEl} on:scroll={onListScroll}>
      {#if !hasFilters}
        <div class="state">请提供筛选参数，例如：?url=https://… 或 ?author=张三 或 ?search=AI 或 ?tags=科技</div>
      {:else if loading && items.length === 0}
        <div class="state">加载中…</div>
      {:else if loadError && items.length === 0}
        <div class="state">{loadError}</div>
      {:else if items.length === 0}
        <div class="state">暂无匹配条目<br><span style="font-size:0.8em;color:#ccc">可尝试其他筛选条件</span></div>
      {:else}
        {#each items as item, idx ((item.guid || item.link || String(idx)) + ':' + idx)}
          <FeedCard
            title={item.title ?? ''}
            link={item.link}
            summary={item.summary}
            author={item.author}
            pubDate={item.pubDate}
            source={item._source ?? (filters.url ? extractSource(filters.url) : undefined)}
            sourceHref={item._sourceRef ? feedsHref(filters.channel || 'all', undefined, { url: item._sourceRef }) : (filters.url ? feedsHref(filters.channel || 'all', undefined, { url: filters.url }) : undefined)}
            authorHref={item.author ? feedsHref(filters.channel || 'all', undefined, { author: item.author.split(',')[0]?.trim() || item.author }) : undefined}
            guid={item.guid}
            onDelete={handleDeleteItem}
          />
        {/each}
        {#if hasMore}
          <div use:sentinelObserver></div>
        {/if}
        {#if loadingMore}
          <div class="load-more-state">加载更多…</div>
        {:else if !hasMore && items.length > 0}
          <div class="load-more-state">已加载全部 {total} 条</div>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if hasFilters || showBackTop}
  <div class="fab-group">
    {#if showBackTop}
      <button class="fab fab-back" on:click={scrollToTop} aria-label="回到顶部">↑</button>
    {/if}
    {#if hasFilters}
      <a class="fab fab-rss" href={rssUrl} target="_blank" rel="noopener" title="RSS 订阅">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="18" r="3"/><path d="M4 6a16 16 0 0 1 16 16"/><path d="M4 11a11 11 0 0 1 11 11"/>
        </svg>
      </a>
    {/if}
  </div>
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

  .feed-filter-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .filter-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .filter-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: #555;
    background: #e8f4fd;
    border-radius: 4px;
    text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .filter-tag:hover {
    background: #d0e8f7;
    color: #333;
  }
  .filter-tag-x {
    font-size: 1rem;
    line-height: 1;
    opacity: 0.7;
  }
  .filter-chip {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    color: #666;
    text-decoration: none;
    border-radius: 999px;
    background: #f5f5f5;
    transition: background 0.15s, color 0.15s;
  }
  .filter-chip:hover { color: #111; background: #eee; }
  .filter-chip.active { color: #fff; background: #111; }
  .filter-tag-btn {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    color: #666;
    background: #f5f5f5;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .filter-tag-btn:hover {
    background: #eee;
    color: #111;
  }
  .filter-today {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: #666;
    cursor: pointer;
    margin-left: auto;
  }
  .filter-today input { cursor: pointer; }

  .feed-list { flex: 1; overflow-y: auto; }
  .feed-list::-webkit-scrollbar { width: 4px; }
  .feed-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

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

  .fab-group {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 50;
  }
  .fab {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    text-decoration: none;
    font-size: 1rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    transition: background 0.15s, color 0.15s;
  }
  .fab-rss {
    background: #fff;
    color: #555;
    border: 1px solid #e0e0e0;
  }
  .fab-rss:hover { color: #111; border-color: #aaa; }
  .fab-back {
    background: #111;
    color: #fff;
    border: none;
  }
  .fab-back:hover { background: #333; }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
