<script lang="ts">
  import { Popover } from 'bits-ui';
  import { fetchJson } from '$lib/fetchJson.js';

  export let open = false;
  export let onClose: (() => void) | undefined = undefined;
  export let onSelect: ((tag: string) => void) | undefined = undefined;
  export let triggerLabel = '标签';
  /** 为 true 时触发器显示为图标按钮（与文字触发器同宽高） */
  export let iconTrigger = false;

  let tags: { name: string; count?: number }[] = [];
  let loading = true;
  let loadError = '';

  async function loadTags() {
    loading = true;
    loadError = '';
    try {
      const data = await fetchJson<{ suggestedTags?: { name: string; count?: number }[] }>('/api/tags');
      const suggested = data?.suggestedTags ?? [];
      tags = suggested
        .filter((t): t is { name: string; count?: number } => Boolean(t?.name))
        .map((t) => ({ name: t.name, count: t.count }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
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

  function handleOpenChange(v: boolean) {
    if (!v) onClose?.();
  }

  $: if (open) loadTags();
</script>

<Popover.Root bind:open onOpenChange={handleOpenChange}>
  <Popover.Trigger class="filter-tag-btn {iconTrigger ? 'trigger-icon' : ''}" title={triggerLabel}>
    <slot name="trigger">{triggerLabel}</slot>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      class="dropdown-panel"
      sideOffset={4}
      align="start"
    >
      <div class="tag-panel">
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
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.filter-tag-btn) {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    color: var(--color-muted-foreground);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition: color 0.15s;
  }
  :global(.filter-tag-btn:hover) {
    color: var(--color-accent-foreground);
  }
  :global(.filter-tag-btn.trigger-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    min-width: 2rem;
  }
  /* Popover.Content 在 Portal 中渲染，需 :global */
  :global(.dropdown-panel) {
    z-index: 50;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    overflow: auto;
    max-height: min(70vh, 320px);
  }
  .tag-panel {
    padding: 0.75rem;
    min-width: 12rem;
  }
  .tag-state {
    padding: 1rem;
    text-align: center;
    color: var(--color-muted-foreground-soft);
    font-size: 0.875rem;
  }
  .tag-state.error {
    color: var(--color-destructive);
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
    color: var(--color-muted-foreground-strong);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s;
  }
  .tag-chip:hover {
    color: var(--color-accent-foreground);
  }
  .tag-count {
    font-size: 0.7rem;
    color: var(--color-muted-foreground-soft);
  }
</style>
