<script lang="ts">
  // 信息流页面：聚合所有订阅条目，支持按订阅过滤
  import { onMount } from 'svelte';

  interface SubMeta { id: string; title?: string; sourceCount: number }
  interface Item {
    title: string; link: string; summary?: string; author?: string;
    pubDate?: string; _subId: string; _subTitle: string;
  }

  let subs: SubMeta[] = [];
  let allItems: Item[] = [];
  let activeFilter = 'all';
  let loading = true;
  let errorMsg = '';
  let refreshing = false;

  $: filteredItems = activeFilter === 'all' ? allItems : allItems.filter((i) => i._subId === activeFilter);

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

  async function loadFeed() {
    refreshing = true;
    errorMsg = '';
    try {
      const subsRes = await fetch('/api/subscription');
      subs = await subsRes.json();
      if (!subs.length) { loading = false; refreshing = false; return; }
      const results = await Promise.allSettled(
        subs.map((sub) => fetch(`/subscription/${encodeURIComponent(sub.id)}`).then((r) => r.json()))
      );
      allItems = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value.items)) {
          r.value.items.forEach((item: Item) => allItems.push({ ...item, _subId: subs[i].id, _subTitle: subs[i].title || subs[i].id }));
        }
      });
      allItems.sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime());
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  onMount(loadFeed);
</script>

<svelte:head><title>信息流 - RssAny</title></svelte:head>

<div class="feed-page">
  <div class="feed-col">
    <div class="feed-header">
      <h2>信息流</h2>
      <div class="feed-header-right">
        {#if filteredItems.length > 0}<span class="item-count">{filteredItems.length} 条</span>{/if}
        <button class="refresh-btn" class:loading={refreshing} on:click={loadFeed} disabled={refreshing}>
          ↺ {refreshing ? '加载中…' : '刷新'}
        </button>
      </div>
    </div>

    {#if subs.length > 0}
      <div class="filter-bar">
        <button class="filter-chip" class:active={activeFilter === 'all'} on:click={() => activeFilter = 'all'}>全部</button>
        {#each subs as sub}
          <button class="filter-chip" class:active={activeFilter === sub.id} on:click={() => activeFilter = sub.id}>
            {sub.title || sub.id}
          </button>
        {/each}
      </div>
    {/if}

    <div class="feed-list">
      {#if loading}
        <div class="state">加载中…</div>
      {:else if errorMsg}
        <div class="state" style="color:#c00">{errorMsg}</div>
      {:else if filteredItems.length === 0}
        <div class="state">
          {#if subs.length === 0}暂无订阅，<a href="/subscriptions">去添加</a>{:else}该订阅暂无内容{/if}
        </div>
      {:else}
        {#each filteredItems as item}
          <div class="item">
            <div class="item-sub">{item._subTitle}</div>
            <a class="item-title" href={item.link} target="_blank" rel="noopener">{item.title}</a>
            {#if item.summary}<p class="item-summary">{item.summary}</p>{/if}
            <div class="item-meta">
              {#if item.author}<span class="item-author">{item.author}</span><span class="item-dot"></span>{/if}
              <span>{relativeTime(item.pubDate)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .feed-page { height: calc(100vh - 48px); display: flex; overflow: hidden; max-width: 720px; width: 100%; margin: 0 auto }
  .feed-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fff; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb }
  .feed-header { padding: 0.875rem 1.25rem; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0 }
  .feed-header h2 { font-size: 0.9375rem; font-weight: 600 }
  .feed-header-right { display: flex; align-items: center; gap: 0.75rem }
  .item-count { font-size: 0.75rem; color: #bbb }
  .refresh-btn { font-size: 0.75rem; color: #888; background: none; border: none; cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: inherit }
  .refresh-btn:hover { color: #111; background: #f5f5f5 }
  .refresh-btn.loading { opacity: 0.5; pointer-events: none }
  .filter-bar { display: flex; gap: 0.25rem; overflow-x: auto; padding: 0.5rem 1.25rem; border-bottom: 1px solid #f0f0f0; flex-shrink: 0 }
  .filter-bar::-webkit-scrollbar { display: none }
  .filter-chip { padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; cursor: pointer; border: 1px solid #e0e0e0; background: #fff; color: #555; white-space: nowrap; transition: all 0.15s; font-family: inherit }
  .filter-chip:hover { border-color: #aaa; color: #111 }
  .filter-chip.active { background: #111; color: #fff; border-color: #111 }
  .feed-list { flex: 1; overflow-y: auto }
  .feed-list::-webkit-scrollbar { width: 4px }
  .feed-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px }
  .item { padding: 1rem 1.25rem; border-bottom: 1px solid #f3f3f3; transition: background 0.1s }
  .item:hover { background: #fafafa }
  .item-sub { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; color: #999; margin-bottom: 0.3rem }
  .item-title { font-size: 0.9rem; font-weight: 500; color: #111; text-decoration: none; display: block; line-height: 1.45; margin-bottom: 0.3rem }
  .item-title:hover { color: #0969da }
  .item-summary { font-size: 0.8rem; color: #666; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 0.4rem }
  .item-meta { display: flex; align-items: center; gap: 0.6rem; font-size: 0.725rem; color: #bbb }
  .item-author { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  .item-dot { width: 2px; height: 2px; background: #ccc; border-radius: 50%; flex-shrink: 0 }
  .state { padding: 3rem 1.5rem; text-align: center; color: #aaa; font-size: 0.875rem; line-height: 1.7 }
  .state a { color: #0969da; text-decoration: none }
  .state a:hover { text-decoration: underline }
  @media (max-width: 600px) { .feed-page { max-width: 100% } .feed-col { border: none } }
</style>
