<script lang="ts">
  import { onMount } from 'svelte';

  interface Plugin {
    id: string;
    listUrlPattern: string;
    hasParser: boolean;
    hasExtractor: boolean;
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
      plugins = await res.json();
    } catch (err) {
      loadError = '加载失败: ' + (err instanceof Error ? err.message : String(err));
    } finally {
      loading = false;
    }
  }

  async function checkAuth(plugin: Plugin) {
    plugin = { ...plugin }; // reactivity
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

  async function openLogin(plugin: Plugin) {
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
  <title>插件管理 - RssAny</title>
</svelte:head>

<div class="container">
  <div class="page-header">
    <h1>插件管理</h1>
    <p class="page-desc">插件扩展了 RssAny 对特定站点的支持，使其能够精准解析列表结构、提取正文内容，并处理需要登录的站点</p>
  </div>

  <div class="info-box">
    <strong>插件的用途</strong>：为任意站点提供定制化的快速接入能力。每个插件对应一类 URL 模式，声明该站点的解析、提取与认证规则，无需修改核心代码即可扩展新站点。
    <ul>
      <li>在 <code>plugins/</code> 目录新建 <code>xxx.rssany.js</code> 即可自动加载</li>
      <li><strong>Parser</strong> — 自定义列表页解析规则，替代通用 LLM 解析，更快更准确</li>
      <li><strong>Extractor</strong> — 自定义正文提取规则，获取完整文章内容</li>
      <li><strong>需要登录</strong> — 该站点需要身份认证，可在此处检查或打开登录页完成授权</li>
    </ul>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>插件 ID</th>
          <th>URL 模式</th>
          <th>能力</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="4" class="loading-cell">加载中…</td></tr>
        {:else if loadError}
          <tr><td colspan="4" class="error-cell">{loadError}</td></tr>
        {:else if plugins.length === 0}
          <tr><td colspan="4" class="empty-cell">暂无插件，请在 plugins/ 目录添加 *.rssany.js 文件</td></tr>
        {:else}
          {#each plugins as plugin (plugin.id)}
            <tr>
              <td class="td-id">{plugin.id}</td>
              <td class="td-pattern">{plugin.listUrlPattern}</td>
              <td class="td-caps">
                {#if plugin.hasAuth}
                  <span class="badge badge-auth">需要登录</span>
                {/if}
                {#if plugin.hasParser}
                  <span class="badge badge-parser">Parser</span>
                {/if}
                {#if plugin.hasExtractor}
                  <span class="badge badge-extractor">Extractor</span>
                {/if}
                {#if !plugin.hasAuth && !plugin.hasParser && !plugin.hasExtractor}
                  <span style="color:#ccc;font-size:0.75rem">—</span>
                {/if}
              </td>
              <td class="td-actions">
                {#if plugin.hasAuth}
                  <button class="btn btn-secondary" on:click={() => checkAuth(plugin)}>检查登录</button>
                  <button class="btn btn-primary" on:click={() => openLogin(plugin)}>打开登录页</button>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

{#if toast}
  <div class="toast show {toastType}">{toast}</div>
{/if}

<style>
  .container {
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  .page-header { margin-bottom: 1.75rem; }
  .page-header h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.3rem; }
  .page-desc { font-size: 0.8125rem; color: #888; line-height: 1.6; }

  .info-box {
    background: #f8f9ff;
    border: 1px solid #dde4ff;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1.75rem;
    font-size: 0.8125rem;
    color: #555;
    line-height: 1.7;
  }
  .info-box strong { color: #111; }
  .info-box code { background: #eef; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.8rem; font-family: monospace; }
  .info-box ul { padding-left: 1.2rem; margin-top: 0.4rem; }
  .info-box li { margin-bottom: 0.2rem; }

  .table-wrap {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 1rem;
  }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #fafafa;
    font-size: 0.75rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.6rem 1rem;
    text-align: left;
    border-bottom: 1px solid #f0f0f0;
  }
  tbody :global(tr) { border-bottom: 1px solid #f5f5f5; transition: background 0.1s; }
  tbody :global(tr:last-child) { border-bottom: none; }
  tbody :global(tr:hover) { background: #fafafa; }
  :global(td) { padding: 0.75rem 1rem; font-size: 0.875rem; vertical-align: middle; }

  .td-id { font-weight: 600; color: #111; white-space: nowrap; }
  .td-pattern { font-family: monospace; font-size: 0.78rem; color: #555; word-break: break-all; max-width: 280px; }
  .td-caps { white-space: nowrap; }
  .td-actions { white-space: nowrap; text-align: right; }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
    margin-right: 0.25rem;
  }
  .badge-auth { background: #fff7e0; color: #92640a; border: 1px solid #f0d080; }
  .badge-parser { background: #e8f4fd; color: #0969da; border: 1px solid #b8dcf8; }
  .badge-extractor { background: #e6f9ee; color: #1a7f37; border: 1px solid #a8e6be; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
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
  .btn-secondary { background: #f0f0f0; color: #333; margin-right: 0.35rem; }
  .btn-secondary:hover { background: #e0e0e0; }

  .loading-cell, .empty-cell { text-align: center; color: #bbb; padding: 2rem; font-size: 0.875rem; }
  .error-cell { text-align: center; color: #c00; padding: 2rem; font-size: 0.875rem; }

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

  @media (max-width: 640px) {
    .td-pattern { display: none; }
    thead th:nth-child(2) { display: none; }
  }
</style>
