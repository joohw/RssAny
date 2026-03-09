<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  interface TopicStat {
    title: string;
    tags?: string[];
    prompt?: string;
    refresh?: number;
    count: number;
    hotness: number;
  }

  const REFRESH_OPTIONS = [1, 3, 7, 14, 30];

  interface TopicCard {
    title: string;
    tags: string[];
    prompt: string;
    refresh: number;
    count: number;
    hotness: number;
    articleHref: string;
    feedsHref: string;
  }

  let cards: TopicCard[] = [];
  let loading = true;
  let loadError = '';
  let showAddForm = false;
  let newTitle = '';
  let newTags = '';
  let newPrompt = '';
  let newRefresh = 1;
  let saving = false;
  let saveMsg = '';
  let contextMenu: { x: number; y: number; topicTitle: string } | null = null;

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/topics');
      const data = (await res.json()) as { stats?: TopicStat[] };
      const list = data.stats ?? [];
      cards = list
        .sort((a, b) => b.hotness - a.hotness)
        .map((s) => ({
          title: s.title,
          tags: s.tags ?? [s.title],
          prompt: s.prompt ?? '',
          refresh: s.refresh ?? 1,
          count: s.count,
          hotness: s.hotness,
          articleHref: '/topics/' + encodeURIComponent(s.title),
          feedsHref: '/feeds?tags=' + (s.tags ?? [s.title]).map(encodeURIComponent).join(','),
        }));
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      cards = [];
    } finally {
      loading = false;
    }
  }

  function getTopicsPayload(): Array<{ title: string; tags: string[]; prompt: string; refresh: number }> {
    return cards.map((c) => ({
      title: c.title,
      tags: c.tags.length ? c.tags : [c.title],
      prompt: c.prompt,
      refresh: c.refresh,
    }));
  }

  async function save(topics: Array<{ title: string; tags: string[]; prompt: string; refresh: number }>) {
    saving = true;
    saveMsg = '';
    try {
      const res = await fetch('/api/topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
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

  function updateRefresh(title: string, refresh: number) {
    if (saving) return;
    const next = cards.map((c) =>
      c.title === title ? { ...c, refresh } : c
    );
    const topics = next.map((c) => ({
      title: c.title,
      tags: c.tags,
      prompt: c.prompt,
      refresh: c.refresh,
    }));
    save(topics);
  }

  function addTopic() {
    const title = newTitle.trim();
    if (!title || saving) return;
    if (cards.some((c) => c.title === title)) {
      saveMsg = '话题已存在';
      setTimeout(() => { saveMsg = ''; }, 1500);
      return;
    }
    const tags = newTags.trim()
      ? newTags.split(',').map((t) => t.trim()).filter(Boolean)
      : [title];
    const topic = {
      title,
      tags,
      prompt: newPrompt.trim(),
      refresh: newRefresh,
    };
    newTitle = '';
    newTags = '';
    newPrompt = '';
    newRefresh = 1;
    showAddForm = false;
    save([...getTopicsPayload(), topic]);
  }

  function removeTopic(title: string) {
    if (saving) return;
    const next = cards.filter((c) => c.title !== title);
    save(next.map((c) => ({ title: c.title, tags: c.tags, prompt: c.prompt, refresh: c.refresh })));
    contextMenu = null;
  }

  function showContextMenu(e: MouseEvent, topicTitle: string) {
    if (saving) return;
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, topicTitle };
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
      <p class="sub">话题包含 title（必填）、tags（关键词）、prompt（描述），refresh 默认 1 天。新内容经 pipeline 打标签后会自动聚合到对应话题，并生成追踪报告。</p>
    </div>

    <div class="add-bar">
      <button
        type="button"
        class="add-btn"
        on:click={() => { showAddForm = !showAddForm; if (!showAddForm) { newTitle = ''; newTags = ''; newPrompt = ''; newRefresh = 1; } }}
        disabled={loading || saving}
      >
        {showAddForm ? '取消' : '+ 添加话题'}
      </button>
      {#if saveMsg}
        <span class="save-msg">{saveMsg}</span>
      {/if}
    </div>

    {#if showAddForm}
      <div class="add-form">
        <div class="form-row">
          <label>标题 <span class="required">*</span></label>
          <input
            type="text"
            placeholder="简短描述，如：A2A协议"
            bind:value={newTitle}
            on:keydown={(e) => e.key === 'Enter' && addTopic()}
          />
        </div>
        <div class="form-row">
          <label>关键词（tags）</label>
          <input
            type="text"
            placeholder="逗号分隔，如：A2A协议,Agent-to-Agent（留空则用标题）"
            bind:value={newTags}
          />
        </div>
        <div class="form-row">
          <label>描述（prompt）</label>
          <textarea
            placeholder="供 Agent 参考，如：关注谷歌、OpenAI 等在 Agent-to-Agent 通信领域的最新进展"
            bind:value={newPrompt}
            rows="2"
          />
        </div>
        <div class="form-row form-actions">
          <select bind:value={newRefresh} title="刷新周期（天）">
            {#each REFRESH_OPTIONS as d}
              <option value={d}>{d} 天</option>
            {/each}
          </select>
          <button type="button" on:click={addTopic} disabled={!newTitle.trim() || saving}>
            添加
          </button>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="state">加载中…</div>
    {:else if loadError}
      <div class="state error">{loadError}</div>
    {:else if cards.length === 0}
      <div class="state">暂无话题。点击「添加话题」创建，需填写标题（必填），可选填关键词和描述。</div>
    {:else}
      <div class="list">
        {#each cards as card (card.title)}
          <div
            class="card"
            role="button"
            tabindex="0"
            title="{card.title}：{card.count} 篇，周期 {card.refresh} 天。点击查看报告，右键删除"
            on:click={() => goto(card.articleHref)}
            on:keydown={(e) => e.key === 'Enter' && goto(card.articleHref)}
            on:contextmenu={(e) => showContextMenu(e, card.title)}
          >
            <div class="card-main">
              <span class="card-label">{card.title}</span>
              <span class="card-tags">{card.tags.join(', ')}</span>
              {#if card.prompt}
                <span class="card-prompt">{card.prompt}</span>
              {/if}
              <span class="card-desc">
                周期 {card.refresh} 天 · 追踪中 ·
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
                value={card.refresh}
                on:change={(e) => { e.stopPropagation(); updateRefresh(card.title, Number((e.target as HTMLSelectElement).value)); }}
                on:click|stopPropagation
                on:mousedown|stopPropagation
                disabled={saving}
                title="刷新周期（天）"
              >
                {#each REFRESH_OPTIONS as d}
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
      on:click={() => removeTopic(contextMenu!.topicTitle)}
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
  .add-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    background: #0969da;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .add-btn:hover:not(:disabled) {
    background: #0550ae;
  }
  .add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .save-msg {
    font-size: 0.75rem;
    color: #059669;
  }

  .add-form {
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    background: #fafafa;
    flex-shrink: 0;
  }
  .form-row {
    margin-bottom: 0.5rem;
  }
  .form-row:last-of-type {
    margin-bottom: 0;
  }
  .form-row label {
    display: block;
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.2rem;
  }
  .required {
    color: #c53030;
  }
  .form-row input,
  .form-row textarea {
    width: 100%;
    padding: 0.4rem 0.6rem;
    font-size: 0.875rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-sizing: border-box;
  }
  .form-row textarea {
    resize: vertical;
    min-height: 2.5rem;
  }
  .form-row input:focus,
  .form-row textarea:focus {
    outline: none;
    border-color: #0969da;
  }
  .form-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .form-actions select {
    font-size: 0.8rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }
  .form-actions button {
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    background: #0969da;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .form-actions button:hover:not(:disabled) {
    background: #0550ae;
  }
  .form-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  .card-tags {
    font-size: 0.7rem;
    color: #6b7280;
  }
  .card-prompt {
    font-size: 0.72rem;
    color: #9ca3af;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
