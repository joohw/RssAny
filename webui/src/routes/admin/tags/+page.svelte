<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJson } from '$lib/fetchJson.js';
  import { showToast } from '$lib/toastStore.js';

  interface TagStat {
    name: string;
    count: number;
    hotness: number;
  }

  let tags: string[] = [];
  let stats: TagStat[] = [];
  let suggestedTags: TagStat[] = [];
  let loading = true;
  let saving = false;
  let newTag = '';
  let contextMenu: { x: number; y: number; tag: string } | null = null;
  let removingFromItems = false;

  async function load() {
    loading = true;
    try {
      const data = await fetchJson<{ tags?: string[]; stats?: TagStat[]; suggestedTags?: TagStat[] }>('/api/tags');
      tags = data?.tags ?? [];
      stats = data?.stats ?? [];
      suggestedTags = data?.suggestedTags ?? [];
    } catch {
      tags = [];
      stats = [];
      suggestedTags = [];
    } finally {
      loading = false;
    }
  }

  function getStat(name: string): TagStat | undefined {
    return stats.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  async function save(newTags: string[]) {
    saving = true;
    try {
      const data = await fetchJson<{ ok?: boolean; message?: string; tags?: string[]; stats?: TagStat[]; suggestedTags?: TagStat[] }>(
        '/api/tags',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: newTags }),
        }
      );
      if (!data?.ok) throw new Error(data?.message ?? '保存失败');
      tags = data?.tags ?? newTags;
      stats = data?.stats ?? [];
      suggestedTags = data?.suggestedTags ?? [];
      showToast('已保存', 'success');
    } catch (e) {
      showToast('保存失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      saving = false;
    }
  }

  function addTag() {
    const t = newTag.trim();
    if (!t || saving) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      showToast('标签已存在', 'error');
      return;
    }
    newTag = '';
    save([...tags, t]);
  }

  function removeTag(name: string) {
    if (saving) return;
    save(tags.filter((t) => t !== name));
  }

  function addSuggested(name: string) {
    if (saving) return;
    if (tags.some((x) => x.toLowerCase() === name.toLowerCase())) return;
    save([...tags, name]);
  }

  function showContextMenu(e: MouseEvent, tag: string) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, tag };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  async function removeTagFromItems(tag: string) {
    if (removingFromItems) return;
    removingFromItems = true;
    contextMenu = null;
    try {
      const data = await fetchJson<{
        ok?: boolean;
        message?: string;
        removedCount?: number;
        tags?: string[];
        stats?: TagStat[];
        suggestedTags?: TagStat[];
      }>('/api/tags/remove-from-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      });
      if (!data?.ok) throw new Error(data?.message ?? '操作失败');
      tags = data?.tags ?? tags;
      stats = data?.stats ?? stats;
      suggestedTags = data?.suggestedTags ?? suggestedTags;
      showToast(`已从 ${data?.removedCount ?? 0} 篇文章中移除该标签`, 'success');
    } catch (e) {
      showToast('操作失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      removingFromItems = false;
    }
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
  <title>标签 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <div class="header-left">
        <h2>系统标签</h2>
        <p class="page-desc">
          系统标签库，新入库条目会由 LLM 自动匹配打标签。
        </p>
      </div>
    </div>

    {#if loading}
      <div class="state">加载中…</div>
    {:else}
      <div class="body">
        <div class="add-row">
          <input
            type="text"
            class="tag-input"
            placeholder="输入新标签，回车添加"
            bind:value={newTag}
            on:keydown={(e) => e.key === 'Enter' && addTag()}
          />
          <button type="button" class="btn btn-primary" on:click={addTag} disabled={!newTag.trim() || saving}>
            添加
          </button>
        </div>

        <div class="tags-section">
          <h3 class="section-title">当前标签 ({tags.length})</h3>
          {#if tags.length === 0}
            <p class="empty-hint">暂无标签。添加后，pipeline 会对新入库条目自动打标签。</p>
          {:else}
            <div class="tag-list">
              {#each tags as tag}
                {@const stat = getStat(tag)}
                <div
                  class="tag-badge"
                  on:contextmenu={(e) => showContextMenu(e, tag)}
                >
                  <a href="/feeds?tags={encodeURIComponent(tag)}" class="tag-name" target="_blank" rel="noopener" on:click|stopPropagation>
                    {tag}
                  </a>
                  {#if stat}
                    <span class="tag-meta">{stat.count} 篇 · 热度 {stat.hotness}</span>
                  {/if}
                  <button
                    type="button"
                    class="tag-remove"
                    title="从系统标签中删除"
                    on:click|stopPropagation={() => removeTag(tag)}
                    disabled={saving}
                  >
                    ×
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if suggestedTags.length > 0}
          <div class="suggested-section">
            <h3 class="section-title">建议添加（文章中出现但未在系统标签库中）</h3>
            <div class="tag-list">
              {#each suggestedTags as s}
                <div
                  class="tag-badge suggested"
                  on:contextmenu={(e) => showContextMenu(e, s.name)}
                >
                  <span class="tag-name">{s.name}</span>
                  <span class="tag-meta">{s.count} 篇 · 热度 {s.hotness}</span>
                  <button
                    type="button"
                    class="tag-add"
                    title="添加到系统标签"
                    on:click|stopPropagation={() => addSuggested(s.name)}
                    disabled={saving}
                  >
                    +
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
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
      on:click={() => removeTagFromItems(contextMenu!.tag)}
      disabled={removingFromItems}
    >
      从所有文章中移除该标签
    </button>
  </div>
{/if}

<style>
  .feed-wrap {
    min-height: calc(100vh - 48px);
    display: flex;
    overflow: auto;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .feed-wrap::-webkit-scrollbar {
    width: 4px;
  }
  .feed-wrap::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
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
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-shrink: 0;
  }
  .feed-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0 0 0.15rem;
  }

  .page-desc {
    font-size: 0.75rem;
    color: #aaa;
    margin: 0;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .body::-webkit-scrollbar {
    width: 4px;
  }
  .body::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 2px;
  }

  .section-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #6b7280;
    margin: 0 0 0.5rem;
  }

  .add-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }

  .tag-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    font-size: 0.875rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }
  .tag-input:focus {
    outline: none;
    border-color: #0969da;
  }

  .btn {
    padding: 0.35rem 0.85rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8125rem;
    font-family: inherit;
  }
  .btn-primary {
    background: #0969da;
    color: #fff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #0550ae;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tags-section,
  .suggested-section {
    margin-bottom: 1.25rem;
  }

  .empty-hint {
    font-size: 0.8125rem;
    color: #9ca3af;
    margin: 0;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tag-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.5rem;
    background: #f3f4f6;
    border-radius: 6px;
    font-size: 0.8125rem;
  }

  .tag-name {
    color: #111;
    text-decoration: none;
  }
  .tag-name:hover {
    color: #0969da;
  }

  .tag-meta {
    font-size: 0.7rem;
    color: #9ca3af;
  }

  .tag-remove,
  .tag-add {
    padding: 0 0.2rem;
    font-size: 1rem;
    line-height: 1;
    color: #9ca3af;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 2px;
  }
  .tag-remove:hover:not(:disabled),
  .tag-add:hover:not(:disabled) {
    color: #e53e3e;
    background: #fee2e2;
  }
  .tag-add:hover:not(:disabled) {
    color: #1a7f37;
    background: #dcfce7;
  }

  .tag-badge.suggested {
    background: #fef3c7;
  }

  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 180px;
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
  .context-menu-item:hover:not(:disabled) {
    background: #f3f4f6;
  }
  .context-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .state {
    text-align: center;
    padding: 4rem;
    color: #aaa;
    font-size: 0.875rem;
  }

  @media (max-width: 600px) {
    .feed-wrap {
      max-width: 100%;
    }
    .feed-col {
      border: none;
    }
  }
</style>
