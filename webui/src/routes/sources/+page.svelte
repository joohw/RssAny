<script lang="ts">
  import { onMount } from 'svelte';

  interface SubscriptionSource {
    ref: string;
    label?: string;
    description?: string;
    refresh?: string;
    proxy?: string;
  }

  interface SourceCard {
    ref: string;
    displayLabel: string;
    description?: string;
    refresh?: string;
    previewHref: string;
  }

  let cards: SourceCard[] = [];
  let loading = true;
  let loadError = '';

  function displayLabelFromRef(url: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname === '/' ? '' : u.pathname;
      const short = path.length > 24 ? path.slice(0, 21) + '…' : path;
      return u.hostname + short;
    } catch {
      return url.length > 48 ? url.slice(0, 45) + '…' : url;
    }
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/sources/raw');
      const raw = await res.text();
      const data = JSON.parse(raw || '{}') as { sources?: SubscriptionSource[] };
      const list = Array.isArray(data.sources) ? data.sources : [];
      cards = list
        .filter((s) => s?.ref?.trim())
        .map((s) => ({
          ref: s.ref.trim(),
          displayLabel: (s.label && s.label.trim()) || displayLabelFromRef(s.ref),
          description: s.description?.trim(),
          refresh: s.refresh,
          previewHref: '/preview?url=' + encodeURIComponent(s.ref.trim()),
        }))
        .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      cards = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head>
  <title>信源 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <h2>信源</h2>
      <p class="sub">sources.json 中的完整信源列表，点击进入预览</p>
    </div>

  {#if loading}
    <div class="state">加载中…</div>
  {:else if loadError}
    <div class="state error">{loadError}</div>
  {:else if cards.length === 0}
    <div class="state">暂无信源。请将 sources.example.json 复制为 .rssany/sources.json 并配置 sources 数组。</div>
  {:else}
    <div class="list">
      {#each cards as card (card.ref)}
        <a class="card" href={card.previewHref} target="_blank" rel="noopener" title={card.ref}>
          <div class="card-main">
            <span class="card-label">{card.displayLabel}</span>
            {#if card.description}
              <span class="card-desc">{card.description}</span>
            {/if}
          </div>
          {#if card.refresh}
            <span class="card-meta">{card.refresh}</span>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
  </div>
</div>

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
    flex-shrink: 0;
  }
  .feed-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }
  .sub {
    font-size: 0.75rem;
    color: #aaa;
    margin: 0;
  }

  .state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1.5rem;
    color: #888;
    font-size: 0.875rem;
  }
  .state.error {
    color: #c53030;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .card {
    background: #fff;
    border: none;
    border-bottom: 1px solid #e5e7eb;
    border-radius: 0;
    padding: 1rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    text-decoration: none;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .card:last-child {
    border-bottom: none;
  }
  .card:hover {
    background: #fafafa;
  }

  .card-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .card-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #111;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card:hover .card-label {
    color: #0969da;
  }
  .card-desc {
    font-size: 0.75rem;
    color: #888;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-meta {
    font-size: 0.7rem;
    color: #888;
    flex-shrink: 0;
  }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
