<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  interface TagStat {
    name: string;
    count: number;
    hotness: number;
    period?: number;
  }

  const PERIOD_OPTIONS = [1, 3, 7, 14, 30];

  interface TopicCard {
    name: string;
    count: number;
    period: number;
    articleHref: string;
    feedsHref: string;
  }

  let cards: TopicCard[] = [];
  let loading = true;
  let loadError = '';
  let newTag = '';
  let saving = false;
  let saveMsg = '';
  let contextMenu: { x: number; y: number; tagName: string } | null = null;

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/tags');
      const data = (await res.json()) as { stats?: TagStat[] };
      const list = data.stats ?? [];
      cards = list
        .sort((a, b) => b.hotness - a.hotness)
        .map((s) => ({
          name: s.name,
          count: s.count,
          period: s.period ?? 1,
          articleHref: '/topics/' + encodeURIComponent(s.name),
          feedsHref: '/feeds?tags=' + encodeURIComponent(s.name),
        }));
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      cards = [];
    } finally {
      loading = false;
    }
  }

  async function save(tags: string[], periods?: Record<string, number>) {
    saving = true;
    saveMsg = '';
    try {
      const res = await fetch('/api/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, periods }),
      });
      const data = (await res.json()) as { ok?: boolean; stats?: TagStat[]; message?: string };
      if (!data.ok) throw new Error(data.message ?? '保存失败');
      await load();
      saveMsg = '已保存';
      setTimeout(() => { saveMsg = ''; }, 2000);
    } catch (e) {
      saveMsg = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function getPeriods(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of cards) {
      out[c.name] = c.period;
    }
    return out;
  }

  function updatePeriod(name: string, period: number) {
    if (saving) return;
    const periods = getPeriods();
    periods[name] = period;
    save(cards.map((c) => c.name), periods);
  }

  function addTag() {
    const t = newTag.trim();
    if (!t || saving) return;
    const existing = cards.map((c) => c.name);
    if (existing.includes(t)) {
      saveMsg = '话题已存在';
      setTimeout(() => { saveMsg = ''; }, 1500);
      return;
    }
    newTag = '';
    const periods = getPeriods();
    periods[t] = 1;
    save([...existing, t], periods);
  }

  function removeTag(name: string) {
    if (saving) return;
    const next = cards.filter((c) => c.name !== name).map((c) => c.name);
    const periods = getPeriods();
    delete periods[name];
    save(next, periods);
    contextMenu = null;
  }

  function showContextMenu(e: MouseEvent, tagName: string) {
    if (saving) return;
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, tagName };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  onMount(() => {
    load();
    const handleClick = () => closeContextMenu();
    const handleContextMenu = () => closeContextMenu();
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  });
</script>

<svelte:head>
  <title>话题 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <h2>话题</h2>
      <p class="sub">添加话题/关键词后，新内容会自动聚合到对应的话题、关键词下，并在后台生成该话题的追踪情况。</p>
    </div>

    <div class="add-bar">
      <input
        type="text"
        placeholder="输入新话题/关键词"
        bind:value={newTag}
        on:keydown={(e) => e.key === 'Enter' && addTag()}
        disabled={loading || saving}
      />
      <button type="button" on:click={addTag} disabled={loading || saving || !newTag.trim()}>
        添加
      </button>
      {#if saveMsg}
        <span class="save-msg">{saveMsg}</span>
      {/if}
    </div>

    {#if loading}
      <div class="state">加载中…</div>
    {:else if loadError}
      <div class="state error">{loadError}</div>
    {:else if cards.length === 0}
      <div class="state">暂无话题。在上方输入框添加话题后，pipeline 会自动为文章打标签，并在此聚合。</div>
    {:else}
      <div class="list">
        {#each cards as card (card.name)}
          <div
            class="card"
            role="button"
            tabindex="0"
            title="{card.name}：{card.count} 篇，周期 {card.period} 天。点击查看报告，右键删除"
            on:click={() => goto(card.articleHref)}
            on:keydown={(e) => e.key === 'Enter' && goto(card.articleHref)}
            on:contextmenu={(e) => showContextMenu(e, card.name)}
          >
            <div class="card-main">
              <span class="card-label">{card.name}</span>
              <span class="card-desc">
                周期 {card.period} 天 · 追踪中 ·
                <a
                  href={card.feedsHref}
                  class="card-feeds-btn"
                  title="查看该话题的 feeds 列表"
                  on:click|stopPropagation
                >查看文章列表</a>
              </span>
            </div>
            <div class="card-right">
              <select
                class="card-period"
                value={card.period}
                on:change={(e) => { e.stopPropagation(); updatePeriod(card.name, Number((e.target as HTMLSelectElement).value)); }}
                on:click|stopPropagation
                on:mousedown|stopPropagation
                disabled={saving}
                title="Track 周期（天）"
              >
                {#each PERIOD_OPTIONS as d}
                  <option value={d}>{d}天</option>
                {/each}
              </select>
              <span class="card-meta">
                {card.count} 篇
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if contextMenu}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    role="menu"
    tabindex="-1"
    on:click|stopPropagation
    on:keydown={(e) => e.key === 'Escape' && closeContextMenu()}
  >
    <button
      type="button"
      class="context-menu-item"
      on:click={() => removeTag(contextMenu!.tagName)}
    >
      删除
    </button>
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

  .add-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .add-bar input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.6rem;
    font-size: 0.875rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }
  .add-bar input:focus {
    outline: none;
    border-color: #0969da;
  }
  .add-bar button {
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    background: #0969da;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .add-bar button:hover:not(:disabled) {
    background: #0550ae;
  }
  .add-bar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .save-msg {
    font-size: 0.75rem;
    color: #059669;
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
    transition: background 0.15s;
    flex-shrink: 0;
    cursor: pointer;
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
  .card-feeds-btn {
    font-size: inherit;
    color: inherit;
    text-decoration: none;
  }
  .card-feeds-btn:hover {
    text-decoration: underline;
  }
  .card-desc {
    font-size: 0.75rem;
    color: #888;
    line-height: 1.3;
  }

  .card-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  .card-period {
    font-size: 0.7rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: #fafafa;
    color: #6b7280;
    cursor: pointer;
  }
  .card-period:hover:not(:disabled) {
    border-color: #d1d5db;
  }
  .card-period:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .card-meta {
    font-size: 0.7rem;
    color: #888;
    min-width: 3rem;
    text-align: right;
  }

  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 100px;
    padding: 0.25rem 0;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    text-align: left;
    color: #111;
    background: none;
    border: none;
    cursor: pointer;
  }
  .context-menu-item:hover {
    background: #f3f4f6;
  }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
