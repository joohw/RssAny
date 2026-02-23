<script lang="ts">
  // 插件管理页面：展示已加载插件及其能力，支持认证检查与登录
  import { onMount } from 'svelte';
  import { showToast } from '$lib/toast.js';

  interface Plugin {
    id: string; listUrlPattern: string;
    hasParser: boolean; hasExtractor: boolean; hasAuth: boolean;
  }

  let plugins: Plugin[] = [];
  let loading = true;
  let authBusy: Record<string, boolean> = {};

  async function loadPlugins() {
    try {
      const res = await fetch('/api/plugins');
      plugins = await res.json();
    } catch (e) {
      showToast('加载失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      loading = false;
    }
  }

  async function checkAuth(id: string) {
    authBusy = { ...authBusy, [id + '_check']: true };
    try {
      const res = await fetch(`/auth/check?siteId=${encodeURIComponent(id)}`);
      const result = await res.json();
      if (result.ok) {
        showToast(`${id}：${result.authenticated ? '✓ 已登录' : '✗ 未登录'}`, result.authenticated ? 'success' : 'error');
      } else {
        showToast(result.message || '检查失败', 'error');
      }
    } catch (e) {
      showToast('请求失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      authBusy = { ...authBusy, [id + '_check']: false };
    }
  }

  async function openLogin(id: string) {
    authBusy = { ...authBusy, [id + '_login']: true };
    try {
      const res = await fetch(`/auth/open?siteId=${encodeURIComponent(id)}`, { method: 'POST' });
      const result = await res.json();
      showToast(result.message || (result.ok ? '已打开登录页面' : '打开失败'), result.ok ? 'success' : 'error');
    } catch (e) {
      showToast('请求失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      authBusy = { ...authBusy, [id + '_login']: false };
    }
  }

  onMount(loadPlugins);
</script>

<svelte:head><title>插件管理 - RssAny</title></svelte:head>

<div class="container">
  <div class="page-header">
    <div>
      <h1>插件管理</h1>
      <p class="page-desc">插件扩展了 RssAny 对特定站点的支持，使其能够精准解析列表结构、提取正文内容，并处理需要登录的站点</p>
    </div>
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
          <th class="hide-sm">URL 模式</th>
          <th>能力</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr class="loading-row"><td colspan="4">加载中…</td></tr>
        {:else if plugins.length === 0}
          <tr class="empty-row"><td colspan="4">暂无插件，请在 plugins/ 目录添加 *.rssany.js 文件</td></tr>
        {:else}
          {#each plugins as p}
            <tr>
              <td class="td-id">{p.id}</td>
              <td class="td-pattern hide-sm">{p.listUrlPattern}</td>
              <td class="td-caps">
                {#if p.hasAuth}<span class="badge badge-auth">需要登录</span>{/if}
                {#if p.hasParser}<span class="badge badge-parser">Parser</span>{/if}
                {#if p.hasExtractor}<span class="badge badge-extractor">Extractor</span>{/if}
                {#if !p.hasAuth && !p.hasParser && !p.hasExtractor}<span style="color:#ccc;font-size:0.75rem">—</span>{/if}
              </td>
              <td class="td-actions">
                {#if p.hasAuth}
                  <button class="btn btn-secondary btn-sm" on:click={() => checkAuth(p.id)} disabled={authBusy[p.id + '_check']}>
                    {authBusy[p.id + '_check'] ? '检查中…' : '检查登录'}
                  </button>
                  <button class="btn btn-primary btn-sm" on:click={() => openLogin(p.id)} disabled={authBusy[p.id + '_login']}>
                    {authBusy[p.id + '_login'] ? '打开中…' : '打开登录页'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .page-desc { font-size: 0.8125rem; color: #888; line-height: 1.6; max-width: 560px; margin-top: 0.3rem }
  .td-id { font-weight: 600; color: #111; white-space: nowrap }
  .td-pattern { font-family: monospace; font-size: 0.78rem; color: #555; word-break: break-all; max-width: 280px }
  .td-caps { white-space: nowrap }
  .td-actions { white-space: nowrap; text-align: right; display: flex; gap: 0.35rem; justify-content: flex-end }
  @media (max-width: 640px) { .hide-sm { display: none } }
</style>
