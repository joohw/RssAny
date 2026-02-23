<script lang="ts">
  // 订阅管理页面：列表展示 + 新建/编辑/删除订阅
  import { onMount } from 'svelte';
  import { showToast } from '$lib/toast.js';

  interface SubscriptionConfig {
    id: string; title?: string; description?: string;
    sources: { url: string }[];
    maxItemsPerSource?: number;
    pullInterval?: string;
  }

  const INTERVAL_LABELS: Record<string, string> = {
    '10min': '每10分钟', '30min': '每30分钟', '1h': '每1小时',
    '6h': '每6小时', '12h': '每12小时', '1day': '每天',
    '3day': '每3天', '7day': '每周',
  };

  let subs: SubscriptionConfig[] = [];
  let loading = true;
  let overlayOpen = false;
  let editingId: string | null = null;
  let saving = false;

  let fId = '', fTitle = '', fDesc = '', fSources = '', fMax = '', fInterval = '';

  async function loadSubscriptions() {
    try {
      const res = await fetch('/api/subscription');
      subs = await res.json();
    } catch (e) {
      showToast('加载失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      loading = false;
    }
  }

  function openModal(idToEdit?: string) {
    editingId = idToEdit || null;
    if (!editingId) { fId = ''; fTitle = ''; fDesc = ''; fSources = ''; fMax = ''; fInterval = ''; }
    overlayOpen = true;
  }

  function openEdit(id: string) {
    const sub = subs.find((s) => s.id === id);
    if (!sub) return;
    fId = sub.id;
    fTitle = sub.title || '';
    fDesc = sub.description || '';
    fSources = sub.sources.map((s) => s.url).join('\n');
    fMax = sub.maxItemsPerSource ? String(sub.maxItemsPerSource) : '';
    fInterval = sub.pullInterval || '';
    openModal(id);
  }

  function closeModal() { overlayOpen = false; editingId = null; }

  async function saveSubscription() {
    const id = editingId || fId.trim();
    if (!editingId && !id) { showToast('请填写订阅 ID', 'error'); return; }
    const sources = fSources.split('\n').map((l) => l.trim()).filter(Boolean).map((url) => ({ url }));
    if (!sources.length) { showToast('请至少添加一个信源 URL', 'error'); return; }
    const config = {
      title: fTitle.trim() || undefined,
      description: fDesc.trim() || undefined,
      sources,
      maxItemsPerSource: fMax ? Number(fMax) : undefined,
      pullInterval: fInterval || undefined,
    };
    saving = true;
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/subscription/${encodeURIComponent(editingId)}` : '/api/subscription';
      const body = editingId ? config : { id, ...config };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!result.ok) throw new Error(result.message || '保存失败');
      closeModal();
      showToast(editingId ? '已更新' : `已创建订阅 "${id}"`);
      await loadSubscriptions();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      saving = false;
    }
  }

  async function confirmDelete(id: string) {
    if (!confirm(`确定删除订阅 "${id}"？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/subscription/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.ok) throw new Error(result.message || '删除失败');
      showToast(`已删除订阅 "${id}"`);
      await loadSubscriptions();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  onMount(loadSubscriptions);
</script>

<svelte:head><title>订阅管理 - RssAny</title></svelte:head>

<div class="container">
  <div class="page-header">
    <h1>订阅管理</h1>
    <button class="btn btn-primary" on:click={() => openModal()}>＋ 新建订阅</button>
  </div>

  {#if loading}
    <div class="loading-state">加载中…</div>
  {:else if subs.length === 0}
    <div class="empty-state">
      <p>暂无订阅</p>
      <button class="btn btn-primary" on:click={() => openModal()}>＋ 新建第一个订阅</button>
    </div>
  {:else}
    {#each subs as sub}
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title-row">
              <span class="card-title">{sub.title || sub.id}</span>
              <span class="card-id">{sub.id}</span>
            </div>
            {#if sub.description}<p class="card-desc" style="margin-top:0.4rem">{sub.description}</p>{/if}
          </div>
        </div>
        <div class="card-sources">
          <div class="sources-label">信源（{sub.sources.length}）</div>
          {#each sub.sources.slice(0, 3) as src}<div class="source-url">{src.url}</div>{/each}
          {#if sub.sources.length > 3}<div class="source-more">…还有 {sub.sources.length - 3} 个信源</div>{/if}
        </div>
        {#if sub.maxItemsPerSource || sub.pullInterval}
          <div class="card-meta-row">
            {#if sub.maxItemsPerSource}<span>每源最多 {sub.maxItemsPerSource} 条</span>{/if}
            {#if sub.pullInterval}<span class="badge badge-interval">{INTERVAL_LABELS[sub.pullInterval] || sub.pullInterval}</span>{/if}
          </div>
        {/if}
        <div class="card-actions">
          <a class="btn btn-secondary btn-sm" href="/subscription/{encodeURIComponent(sub.id)}" target="_blank">查看 JSON</a>
          <button class="btn btn-secondary btn-sm" on:click={() => openEdit(sub.id)}>编辑</button>
          <button class="btn btn-danger btn-sm" on:click={() => confirmDelete(sub.id)}>删除</button>
        </div>
      </div>
    {/each}
  {/if}
</div>

<!-- 新建/编辑 Modal -->
<div class="overlay" class:open={overlayOpen} on:click|self={closeModal} role="dialog" aria-modal="true">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">{editingId ? '编辑订阅' : '新建订阅'}</span>
      <button class="modal-close" on:click={closeModal}>×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="f-id">订阅 ID <span style="color:#c00">*</span></label>
      <input class="form-input" id="f-id" bind:value={fId} disabled={!!editingId} placeholder="tech / ai-feeds" autocomplete="off" />
      <p class="form-hint">唯一标识，创建后不可修改</p>
    </div>
    <div class="form-group">
      <label class="form-label" for="f-title">标题</label>
      <input class="form-input" id="f-title" bind:value={fTitle} placeholder="科技信息流" />
    </div>
    <div class="form-group">
      <label class="form-label" for="f-desc">描述</label>
      <input class="form-input" id="f-desc" bind:value={fDesc} placeholder="（可选）" />
    </div>
    <div class="form-group">
      <label class="form-label" for="f-sources">信源 URL <span style="color:#c00">*</span></label>
      <textarea class="form-input" id="f-sources" bind:value={fSources} placeholder="每行一个 URL"></textarea>
      <p class="form-hint">每行一个列表页 URL</p>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="f-max">每源最多条目</label>
        <input class="form-input" id="f-max" type="number" min="1" max="200" bind:value={fMax} placeholder="留空不限制" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-interval">定时拉取间隔</label>
        <select class="form-input" id="f-interval" bind:value={fInterval}>
          <option value="">不自动拉取</option>
          <option value="10min">每 10 分钟</option>
          <option value="30min">每 30 分钟</option>
          <option value="1h">每 1 小时</option>
          <option value="6h">每 6 小时</option>
          <option value="12h">每 12 小时</option>
          <option value="1day">每天</option>
          <option value="3day">每 3 天</option>
          <option value="7day">每周</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" on:click={closeModal}>取消</button>
      <button class="btn btn-primary" on:click={saveSubscription} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
    </div>
  </div>
</div>

<style>
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1rem }
  .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem }
  .card-title-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap }
  .card-title { font-size: 1rem; font-weight: 600 }
  .card-id { font-size: 0.75rem; color: #888; background: #f5f5f5; padding: 0.15rem 0.5rem; border-radius: 4px; font-family: monospace }
  .card-desc { font-size: 0.8125rem; color: #666; line-height: 1.5 }
  .card-sources { margin-bottom: 0.875rem }
  .sources-label { font-size: 0.75rem; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem }
  .source-url { font-size: 0.8rem; color: #0969da; word-break: break-all; line-height: 1.6; display: flex; align-items: flex-start; gap: 0.4rem }
  .source-url::before { content: '•'; color: #ccc; flex-shrink: 0; margin-top: 0.1rem }
  .source-more { font-size: 0.75rem; color: #aaa; margin-top: 0.2rem; padding-left: 1rem }
  .card-meta-row { display: flex; gap: 1rem; align-items: center; font-size: 0.75rem; color: #aaa; margin-bottom: 0.875rem }
  .card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap }
</style>
