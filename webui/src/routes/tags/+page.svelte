<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fetchJson } from '$lib/fetchJson.js';

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
  }

  let cards: TopicCard[] = [];
  let loading = true;
  let loadError = '';
  let showAddForm = false;
  let showEditForm = false;
  let editTarget: TopicCard | null = null;
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
      const data = await fetchJson<{ stats?: TopicStat[] }>('/api/topics');
      const list = data?.stats ?? [];
      cards = list        .map((s) => ({
          title: s.title,
          tags: s.tags ?? [s.title],
          prompt: s.prompt ?? '',
          refresh: s.refresh ?? 1,
          count: s.count,
          hotness: s.hotness,
          articleHref: '/topics/' + encodeURIComponent(s.title),
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
      const data = await fetchJson<{ ok?: boolean; message?: string }>('/api/topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics }),
      });
      if (!data?.ok) throw new Error(data?.message ?? '保存失败');
      await load();
      saveMsg = '已保存';
      setTimeout(() => { saveMsg = ''; }, 2000);
    } catch (e) {
      saveMsg = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
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
    closeAddModal();
    save([...getTopicsPayload(), topic]);
  }

  function openEditModal(card: TopicCard) {
    editTarget = card;
    newTitle = card.title;
    newTags = card.tags.join(', ');
    newPrompt = card.prompt;
    newRefresh = card.refresh;
    showEditForm = true;
    contextMenu = null;
  }

  function saveEdit() {
    if (!editTarget || saving) return;
    const title = newTitle.trim();
    if (!title) return;
    const tags = newTags.trim()
      ? newTags.split(',').map((t) => t.trim()).filter(Boolean)
      : [title];
    if (title !== editTarget.title && cards.some((c) => c.title === title)) {
      saveMsg = '话题已存在';
      setTimeout(() => { saveMsg = ''; }, 1500);
      return;
    }
    const next = cards.map((c) =>
      c.title === editTarget!.title
        ? { ...c, title, tags, prompt: newPrompt.trim(), refresh: newRefresh }
        : c
    );
    closeEditModal();
    save(next.map((c) => ({ title: c.title, tags: c.tags, prompt: c.prompt, refresh: c.refresh })));
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

  function closeAddModal() {
    showAddForm = false;
    newTitle = '';
    newTags = '';
    newPrompt = '';
    newRefresh = 1;
  }

  function closeEditModal() {
    showEditForm = false;
    editTarget = null;
    newTitle = '';
    newTags = '';
    newPrompt = '';
    newRefresh = 1;
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

<svelte:window on:keydown={(e) => {
  if (e.key === 'Escape') {
    if (showAddForm) closeAddModal();
    else if (showEditForm) closeEditModal();
  }
}} />

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <div class="header-left">
        <h2>话题</h2>
        <p class="sub">话题包含 title（必填）、tags（关键词）、prompt（描述），refresh 默认 1 天。新内容经 pipeline 打标签后会自动聚合到对应话题，并生成追踪报告。</p>
      </div>
      <div class="header-right">
        {#if saveMsg}
          <span class="save-msg">{saveMsg}</span>
        {/if}
        <button
          type="button"
          class="add-btn"
          on:click={() => { showAddForm = true; newTitle = ''; newTags = ''; newPrompt = ''; newRefresh = 1; }}
          disabled={loading || saving}
        >
          + 添加话题
        </button>
      </div>
    </div>

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
            title="{card.title}。点击查看报告，右键编辑或删除"
            on:click={() => goto(card.articleHref)}
            on:keydown={(e) => e.key === 'Enter' && goto(card.articleHref)}
            on:contextmenu={(e) => showContextMenu(e, card.title)}
          >
            <div class="card-main">
              <span class="card-label">{card.title}</span>
              {#if card.prompt}
                <span class="card-prompt">{card.prompt}</span>
              {/if}
              {#if card.tags.length > 0}
                <div class="card-tags-wrap">
                  {#each card.tags as tag}
                    <a
                      href="/feeds?tags={encodeURIComponent(tag)}"
                      class="card-tag-badge"
                      title="按标签筛选文章"
                      on:click|stopPropagation
                    >{tag}</a>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if showAddForm}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    on:click|self={closeAddModal}
  >
    <div class="modal-dialog" on:click|stopPropagation>
      <div class="modal-header">
        <h3 id="modal-title">添加话题</h3>
        <button type="button" class="modal-close" on:click={closeAddModal} aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label for="new-title">标题 <span class="required">*</span></label>
          <input
            id="new-title"
            type="text"
            placeholder="简短描述，如：A2A协议"
            bind:value={newTitle}
            on:keydown={(e) => e.key === 'Enter' && addTopic()}
          />
        </div>
        <div class="form-row">
          <label for="new-tags">关键词（tags）</label>
          <input
            id="new-tags"
            type="text"
            placeholder="逗号分隔，如：A2A协议,Agent-to-Agent（留空则用标题）"
            bind:value={newTags}
          />
        </div>
        <div class="form-row">
          <label for="new-prompt">描述（prompt）</label>
          <p class="field-hint">主导报告生成逻辑，供 Agent 参考。若有 tags 会作为搜索提示插入；无 tags 时 agent 可自行选择获取方式（如日报用 get_channel_feeds 获取全部文章）。</p>
          <textarea
            id="new-prompt"
            placeholder="如：关注谷歌、OpenAI 等在 Agent-to-Agent 通信领域的最新进展"
            bind:value={newPrompt}
            rows="5"
          ></textarea>
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
    </div>
  </div>
{/if}

{#if contextMenu}
  {@const card = cards.find((c) => c.title === contextMenu!.topicTitle)}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    role="menu"
    tabindex="-1"
    on:click|stopPropagation
    on:keydown={(e) => e.key === 'Escape' && closeContextMenu()}
  >
    {#if card}
      <button
        type="button"
        class="context-menu-item"
        on:click={() => openEditModal(card)}
      >
        编辑
      </button>
      <button
        type="button"
        class="context-menu-item"
        on:click={() => removeTopic(contextMenu!.topicTitle)}
      >
        删除
      </button>
    {/if}
  </div>
{/if}

{#if showEditForm}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="edit-modal-title"
    on:click|self={closeEditModal}
  >
    <div class="modal-dialog" on:click|stopPropagation>
      <div class="modal-header">
        <h3 id="edit-modal-title">编辑话题</h3>
        <button type="button" class="modal-close" on:click={closeEditModal} aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label for="edit-title">标题 <span class="required">*</span></label>
          <input
            id="edit-title"
            type="text"
            placeholder="简短描述，如：A2A协议"
            bind:value={newTitle}
            on:keydown={(e) => e.key === 'Enter' && saveEdit()}
          />
        </div>
        <div class="form-row">
          <label for="edit-tags">关键词（tags）</label>
          <input
            id="edit-tags"
            type="text"
            placeholder="逗号分隔，留空则用标题"
            bind:value={newTags}
          />
        </div>
        <div class="form-row">
          <label for="edit-prompt">描述（prompt）</label>
          <p class="field-hint">主导报告生成逻辑，供 Agent 参考。</p>
          <textarea
            id="edit-prompt"
            placeholder="如：关注谷歌、OpenAI 等在 Agent-to-Agent 通信领域的最新进展"
            bind:value={newPrompt}
            rows="5"
          ></textarea>
        </div>
        <div class="form-row form-actions">
          <select bind:value={newRefresh} title="刷新周期（天）">
            {#each REFRESH_OPTIONS as d}
              <option value={d}>{d} 天</option>
            {/each}
          </select>
          <button type="button" on:click={saveEdit} disabled={!newTitle.trim() || saving}>
            保存
          </button>
        </div>
      </div>
    </div>
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
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .header-left {
    flex: 1;
    min-width: 0;
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
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    padding: 1rem;
  }
  .modal-dialog {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    max-width: 420px;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .modal-header h3 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
  }
  .modal-close {
    font-size: 1.25rem;
    line-height: 1;
    padding: 0.2rem;
    color: #6b7280;
    background: none;
    border: none;
    cursor: pointer;
  }
  .modal-close:hover {
    color: #111;
  }
  .modal-body {
    padding: 1rem 1.25rem;
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
    min-height: 6rem;
  }
  .field-hint {
    font-size: 0.7rem;
    color: #9ca3af;
    margin: 0 0 0.35rem;
    line-height: 1.4;
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
    padding-bottom: 200px;
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
  .card-tags-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  .card-tag-badge {
    font-size: 0.65rem;
    padding: 0.15rem 0.4rem;
    background: #f3f4f6;
    color: #6b7280;
    border-radius: 4px;
    text-decoration: none;
    cursor: pointer;
  }
  .card-tag-badge:hover {
    background: #e5e7eb;
    color: #374151;
  }
  .card-prompt {
    font-size: 0.72rem;
    color: #9ca3af;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
