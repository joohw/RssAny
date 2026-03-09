<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { fetchJson } from '$lib/fetchJson.js';

  export let open = false;
  export let onClose: (() => void) | undefined = undefined;
  export let onSelect: ((tag: string) => void) | undefined = undefined;

  let tags: { name: string; count?: number }[] = [];
  let loading = true;
  let loadError = '';

  async function loadTags() {
    loading = true;
    loadError = '';
    try {
      const data = await fetchJson<{ suggestedTags?: { name: string; count?: number }[]; stats?: { tags?: string[] }[] }>('/api/topics');
      const suggested = data?.suggestedTags ?? [];
      const fromStats = (data?.stats ?? [])
        .flatMap((s) => s?.tags ?? [])
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '');
      const seen = new Set<string>();
      const merged: { name: string; count?: number }[] = [];
      for (const t of suggested) {
        if (t?.name && !seen.has(t.name)) {
          seen.add(t.name);
          merged.push({ name: t.name, count: t.count });
        }
      }
      for (const t of fromStats) {
        const name = t.trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          merged.push({ name });
        }
      }
      tags = merged.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      tags = [];
    } finally {
      loading = false;
    }
  }

  function selectTag(tag: string) {
    onSelect?.(tag);
    onClose?.();
  }

  $: if (open) loadTags();
</script>

{#if open}
  <Modal title="选择标签" onClose={onClose}>
    {#if loading}
      <div class="tag-state">加载中…</div>
    {:else if loadError}
      <div class="tag-state error">{loadError}</div>
    {:else if tags.length === 0}
      <div class="tag-state">暂无标签</div>
    {:else}
      <div class="tag-chips">
        {#each tags as { name, count }}
          <button
            type="button"
            class="tag-chip"
            on:click={() => selectTag(name)}
          >
            {name}
            {#if count != null}
              <span class="tag-count">{count}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .tag-state {
    padding: 1.5rem;
    text-align: center;
    color: #888;
    font-size: 0.875rem;
  }
  .tag-state.error {
    color: #c53030;
  }
  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.65rem;
    font-size: 0.8125rem;
    color: #374151;
    background: #f3f4f6;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .tag-chip:hover {
    background: #e5e7eb;
    color: #111;
  }
  .tag-count {
    font-size: 0.7rem;
    color: #9ca3af;
  }
</style>
