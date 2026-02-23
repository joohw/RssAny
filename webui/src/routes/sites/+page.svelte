<script lang="ts">
  // 站点配置页面：管理 sites.json，配置代理与刷新间隔
  import { onMount } from 'svelte';
  import { showToast } from '$lib/toast.js';

  interface SiteEntry { pattern: string; proxy?: string; refresh?: string }

  let entries: SiteEntry[] = [];
  let loading = true;
  let overlayOpen = false;
  let editingPattern: string | null = null;
  let saving = false;

  let fPattern = '', fProxy = '', fRefresh = '';

  async function loadEntries() {
    try {
      const res = await fetch('/api/sites');
      entries = await res.json();
    } catch (e) {
      showToast('加载失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      loading = false;
    }
  }

  function openModal(patternToEdit?: string) {
    editingPattern = patternToEdit || null;
    if (!editingPattern) { fPattern = ''; fProxy = ''; fRefresh = ''; }
    overlayOpen = true;
  }

  function openEdit(pattern: string) {
    const entry = entries.find((e) => e.pattern === pattern);
    if (!entry) return;
    fPattern = entry.pattern;
    fProxy = entry.proxy || '';
    fRefresh = entry.refresh || '';
    openModal(pattern);
  }

  function closeModal() { overlayOpen = false; editingPattern = null; }

  async function saveEntry() {
    const pattern = editingPattern || fPattern.trim();
    if (!pattern) { showToast('请填写 URL 正则', 'error'); return; }
    saving = true;
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, proxy: fProxy.trim() || undefined, refresh: fRefresh || undefined }),
      });
      const result = await res.json();
      if (!result.ok) throw new Error(result.message || '保存失败');
      closeModal();
      showToast(editingPattern ? '已更新' : '已添加规则');
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      saving = false;
    }
  }

  async function confirmDelete(pattern: string) {
    if (!confirm(`确定删除规则 "${pattern}"？`)) return;
    try {
      const res = await fetch('/api/sites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern }),
      });
      const result = await res.json();
      if (!result.ok) throw new Error(result.message || '删除失败');
      showToast(`已删除规则 "${pattern}"`);
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  onMount(loadEntries);
</script>

<svelte:head><title>站点配置 - RssAny</title></svelte:head>

<div class="container">
  <div class="page-header">
    <div>
      <h1>站点配置</h1>
      <p class="page-desc">管理 sites.json，为任意站点添加代理和刷新间隔规则</p>
    </div>
    <button class="btn btn-primary" on:click={() => openModal()}>＋ 添加规则</button>
  </div>

  <div class="info-box">
    <strong>匹配规则</strong>：key 为 URL 正则表达式，请求 URL 与 pattern 匹配时应用对应配置。多条 pattern 同时命中时，<strong>越长的 pattern 越具体</strong>，各字段独立取最具体的值。
    <ul>
      <li><code>proxy</code> — 代理地址，格式 <code>http://host:port</code> 或 <code>socks5://host:port</code></li>
      <li><code>refresh</code> — 刷新间隔，决定 feed 缓存的时间窗口，可选值：<code>10min</code> <code>30min</code> <code>1h</code> <code>6h</code> <code>12h</code> <code>1day</code> <code>3day</code> <code>7day</code></li>
    </ul>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>URL 正则 (pattern)</th>
          <th class="hide-sm">代理 (proxy)</th>
          <th>刷新间隔</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr class="loading-row"><td colspan="4">加载中…</td></tr>
        {:else if entries.length === 0}
          <tr class="empty-row"><td colspan="4">暂无配置，点击「添加规则」开始</td></tr>
        {:else}
          {#each entries as entry}
            <tr>
              <td class="td-pattern">{entry.pattern}</td>
              <td class="td-proxy hide-sm">{entry.proxy || '—'}</td>
              <td class="td-refresh">
                {#if entry.refresh}<span class="refresh-badge">{entry.refresh}</span>{:else}<span style="color:#ccc">默认</span>{/if}
              </td>
              <td class="td-actions">
                <button class="btn btn-secondary btn-sm" on:click={() => openEdit(entry.pattern)} style="margin-right:0.4rem">编辑</button>
                <button class="btn btn-danger btn-sm" on:click={() => confirmDelete(entry.pattern)}>删除</button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<div class="overlay" class:open={overlayOpen} on:click|self={closeModal} role="dialog" aria-modal="true">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">{editingPattern ? '编辑规则' : '添加规则'}</span>
      <button class="modal-close" on:click={closeModal}>×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="f-pattern">URL 正则 (pattern) <span style="color:#c00">*</span></label>
      <input class="form-input" id="f-pattern" bind:value={fPattern} disabled={!!editingPattern} placeholder="xiaohongshu\\.com" autocomplete="off" spellcheck="false" />
      <p class="form-hint">不需要加 / 包裹，直接写正则内容。例：<code>xiaohongshu\\.com</code>、<code>^https://x\\.com/</code></p>
    </div>
    <div class="form-group">
      <label class="form-label" for="f-proxy">代理 (proxy)</label>
      <input class="form-input" id="f-proxy" bind:value={fProxy} placeholder="http://127.0.0.1:7890（留空则不使用代理）" spellcheck="false" />
    </div>
    <div class="form-group">
      <label class="form-label" for="f-refresh">刷新间隔 (refresh)</label>
      <select class="form-input" id="f-refresh" bind:value={fRefresh}>
        <option value="">默认 (1day)</option>
        <option value="10min">10 分钟</option>
        <option value="30min">30 分钟</option>
        <option value="1h">1 小时</option>
        <option value="6h">6 小时</option>
        <option value="12h">12 小时</option>
        <option value="1day">1 天</option>
        <option value="3day">3 天</option>
        <option value="7day">7 天</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" on:click={closeModal}>取消</button>
      <button class="btn btn-primary" on:click={saveEntry} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
    </div>
  </div>
</div>

<style>
  .page-desc { font-size: 0.8125rem; color: #888; line-height: 1.6; max-width: 560px; margin-top: 0.3rem }
  .td-pattern { font-family: monospace; font-size: 0.8rem; color: #111; word-break: break-all; max-width: 260px }
  .td-proxy { font-size: 0.8rem; color: #555; font-family: monospace; word-break: break-all; max-width: 200px }
  .td-refresh { font-size: 0.8rem }
  .refresh-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #f0f0f0; color: #555; font-size: 0.75rem }
  .td-actions { white-space: nowrap; text-align: right }
  @media (max-width: 600px) { .hide-sm { display: none } }
</style>
