<script lang="ts">
  import { onMount } from 'svelte';

  interface SourceRefCard {
    ref: string;
    displayLabel: string;
    previewHref: string;
  }

  let cards: SourceRefCard[] = [];
  let loading = true;
  let loadError = '';

  function displayLabel(url: string): string {
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
      const res = await fetch('/api/channels/raw');
      const raw = await res.text();
      const data = JSON.parse(raw || '{}') as Record<string, { sourceRefs?: string[] }>;
      const refSet = new Set<string>();
      for (const ch of Object.values(data)) {
        if (!Array.isArray(ch.sourceRefs)) continue;
        for (const ref of ch.sourceRefs) {
          const r = ref.trim();
          if (r) refSet.add(r);
        }
      }
      cards = Array.from(refSet)
        .sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)))
        .map((ref) => ({
          ref,
          displayLabel: displayLabel(ref),
          previewHref: '/preview?url=' + encodeURIComponent(ref),
        }));
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
      <p class="sub">频道中所有可用的订阅源（ref），点击进入预览</p>
    </div>

  {#if loading}
    <div class="state">加载中…</div>
  {:else if loadError}
    <div class="state error">{loadError}</div>
  {:else if cards.length === 0}
    <div class="state">暂无订阅源。请在「频道」中配置 channels.json，为频道添加 sourceRefs。</div>
  {:else}
    <div class="list">
      {#each cards as card (card.ref)}
        <a class="card" href={card.previewHref} target="_blank" rel="noopener" title={card.ref}>
          <span class="card-label">{card.displayLabel}</span>
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
    display: block;
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

  .card-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #111;
    line-height: 1.4;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card:hover .card-label {
    color: #0969da;
  }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
