<script lang="ts">
  import { onMount } from 'svelte';

  interface Plugin {
    id: string;
    listUrlPattern: string;
    hasEnrich: boolean;
    hasAuth: boolean;
  }

  let plugins: Plugin[] = [];
  let loadError = '';
  let loading = true;
  let toast = '';
  let toastType = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, type = '') {
    toast = msg;
    toastType = type;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; }, 3500);
  }

  async function loadPlugins() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/plugins');
      const list = await res.json() as Plugin[];
      // 需要登录的放前面
      plugins = [...list].sort((a, b) => (b.hasAuth ? 1 : 0) - (a.hasAuth ? 1 : 0));
    } catch (err) {
      loadError = '加载失败: ' + (err instanceof Error ? err.message : String(err));
    } finally {
      loading = false;
    }
  }

  async function checkAuth(plugin: Plugin, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/auth/check?siteId=${encodeURIComponent(plugin.id)}`);
      const result = await res.json();
      if (result.ok) {
        showToast(`${plugin.id}：${result.authenticated ? '✓ 已登录' : '✗ 未登录'}`, result.authenticated ? 'success' : 'error');
      } else {
        showToast(result.message || '检查失败', 'error');
      }
    } catch (err) {
      showToast('请求失败: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  async function openLogin(plugin: Plugin, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/auth/open?siteId=${encodeURIComponent(plugin.id)}`, { method: 'POST' });
      const result = await res.json();
      if (result.ok) {
        showToast(result.message || '已打开登录页面', 'success');
      } else {
        showToast(result.message || '打开失败', 'error');
      }
    } catch (err) {
      showToast('请求失败: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  onMount(loadPlugins);
</script>

<svelte:head>
  <title>插件 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <h2>插件</h2>
      <p class="sub">已加载的站点插件，需登录的站点可在此检查或打开登录页</p>
    </div>

    {#if loading}
      <div class="state">加载中…</div>
    {:else if loadError}
      <div class="state error">{loadError}</div>
    {:else if plugins.length === 0}
      <div class="state">暂无插件，请在 plugins/ 目录添加 *.rssany.js 文件</div>
    {:else}
      <div class="list">
        {#each plugins as plugin (plugin.id)}
          <div class="row">
            <div class="row-main">
              <span class="row-id">{plugin.id}</span>
              <span class="row-pattern" title={plugin.listUrlPattern}>{plugin.listUrlPattern}</span>
            </div>
            {#if plugin.hasAuth}
              <div class="row-actions">
                <button type="button" class="btn btn-secondary" on:click={(e) => checkAuth(plugin, e)}>检查登录</button>
                <button type="button" class="btn btn-primary" on:click={(e) => openLogin(plugin, e)}>打开登录页</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if toast}
  <div class="toast {toastType}">{toast}</div>
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

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e5e7eb;
    background: #fff;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row:hover {
    background: #fafafa;
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .row-id {
    font-size: 0.9rem;
    font-weight: 500;
    color: #111;
  }
  .row-pattern {
    font-size: 0.78rem;
    font-family: monospace;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .btn {
    padding: 0.35rem 0.7rem;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.8rem;
    font-family: inherit;
    transition: background 0.15s;
  }
  .btn-primary { background: #111; color: #fff; }
  .btn-primary:hover { background: #333; }
  .btn-secondary { background: #f0f0f0; color: #333; }
  .btn-secondary:hover { background: #e0e0e0; }

  .toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #111;
    color: #fff;
    padding: 0.625rem 1.25rem;
    border-radius: 8px;
    font-size: 0.875rem;
    z-index: 100;
    white-space: nowrap;
    pointer-events: none;
  }
  .toast.error { background: #c0392b; }
  .toast.success { background: #1a7f37; }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
    .row { flex-wrap: wrap; }
    .row-pattern { display: none; }
  }
</style>
