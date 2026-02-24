<script lang="ts">
  import { onMount } from 'svelte';

  // ── Tab ───────────────────────────────────────────────────────────────────────
  type Tab = 'rss' | 'parse' | 'extract' | 'plugins';
  let activeTab: Tab = 'rss';

  function switchTab(tab: Tab) {
    activeTab = tab;
    result = '';
    error = '';
    if (tab === 'plugins' && plugins === null) loadPlugins();
  }

  // ── Dev tools 共用 ─────────────────────────────────────────────────────────────
  let url = '';
  let headful = false;
  let pending = false;
  let result = '';
  let error = '';

  async function run() {
    if (!url.trim() || pending) return;
    const fullUrl = url.startsWith('http') ? url : 'https://' + url;
    pending = true;
    result = '';
    error = '';
    try {
      if (activeTab === 'rss') {
        const params = new URLSearchParams({ url: fullUrl });
        if (headful) params.set('headless', 'false');
        window.open('/preview?' + params.toString(), '_blank');
        pending = false;
        return;
      }
      const endpoint = activeTab === 'parse' ? '/parse/' : '/extractor/';
      const params = new URLSearchParams();
      if (headful) params.set('headless', 'false');
      const qs = params.toString();
      const res = await fetch(endpoint + encodeURIComponent(fullUrl) + (qs ? `?${qs}` : ''));
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        result = JSON.stringify(await res.json(), null, 2);
      } else {
        result = await res.text();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      pending = false;
    }
  }

  const tabLabels: Record<Tab, string> = { rss: 'RSS', parse: 'Parse', extract: 'Extract', plugins: '插件' };
  const tabDescs: Record<Tab, string> = {
    rss: '将列表页生成 RSS 订阅源，在新标签页打开预览',
    parse: '从列表页解析条目列表（title、link、summary 等），返回 JSON',
    extract: '从详情页提取完整正文内容（title、author、contentHtml 等），返回 JSON',
    plugins: '',
  };
  const tabPlaceholders: Record<Tab, string> = {
    rss: '列表页 URL…', parse: '列表页 URL…', extract: '文章详情页 URL…', plugins: '',
  };
  const tabBtnLabels: Record<Tab, string> = {
    rss: '生成 RSS', parse: '解析', extract: '提取', plugins: '',
  };

  // ── Plugins ───────────────────────────────────────────────────────────────────
  interface Plugin { id: string; listUrlPattern: string; hasParser: boolean; hasExtractor: boolean; hasAuth: boolean; }
  let plugins: Plugin[] | null = null;
  let pluginsError = '';
  let pluginsLoading = false;
  let checkingAuth = new Set<string>();   // 正在检查登录的插件 id
  let openingLogin = new Set<string>();   // 正在打开登录页的插件 id
  let toast = '';
  let toastType = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, type = '') {
    toast = msg; toastType = type;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; }, 3500);
  }

  async function loadPlugins() {
    pluginsLoading = true;
    pluginsError = '';
    try {
      const res = await fetch('/api/plugins');
      plugins = await res.json();
    } catch (e) {
      pluginsError = '加载失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      pluginsLoading = false;
    }
  }

  async function checkAuth(plugin: Plugin) {
    if (checkingAuth.has(plugin.id)) return;
    checkingAuth = new Set(checkingAuth).add(plugin.id);
    try {
      const res = await fetch(`/auth/check?siteId=${encodeURIComponent(plugin.id)}`);
      const r = await res.json();
      showToast(r.ok ? `${plugin.id}：${r.authenticated ? '✓ 已登录' : '✗ 未登录'}` : (r.message || '检查失败'), r.authenticated ? 'success' : 'error');
    } catch (e) {
      showToast('请求失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      const next = new Set(checkingAuth);
      next.delete(plugin.id);
      checkingAuth = next;
    }
  }

  async function openLogin(plugin: Plugin) {
    if (openingLogin.has(plugin.id)) return;
    openingLogin = new Set(openingLogin).add(plugin.id);
    try {
      const res = await fetch(`/auth/open?siteId=${encodeURIComponent(plugin.id)}`, { method: 'POST' });
      const r = await res.json();
      showToast(r.message || (r.ok ? '已打开登录页面' : '打开失败'), r.ok ? 'success' : 'error');
    } catch (e) {
      showToast('请求失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      const next = new Set(openingLogin);
      next.delete(plugin.id);
      openingLogin = next;
    }
  }

  onMount(() => {
    // 默认不加载插件，切到插件 Tab 时才懒加载
  });
</script>

<svelte:head>
  <title>Admin - RssAny</title>
</svelte:head>

<div class="page">
  <!-- Tabs -->
  <div class="tabs">
    {#each (['rss', 'parse', 'extract', 'plugins'] as Tab[]) as tab}
      <button class:active={activeTab === tab} on:click={() => switchTab(tab)}>
        {tabLabels[tab]}
      </button>
    {/each}
  </div>

  <!-- Dev Tools (RSS / Parse / Extract) -->
  {#if activeTab !== 'plugins'}
    <p class="desc">{tabDescs[activeTab]}</p>

    <form on:submit|preventDefault={run} class="form">
      <input
        type="url"
        bind:value={url}
        placeholder={tabPlaceholders[activeTab]}
        autocomplete="off"
      />
      <button type="submit" disabled={pending || !url.trim()}>
        {pending ? '请求中…' : tabBtnLabels[activeTab]}
      </button>
    </form>

    <label class="headful-toggle">
      <input type="checkbox" bind:checked={headful} />
      <span>Headful 模式</span>
      <span class="toggle-hint">（使用有头浏览器，可观察加载过程与手动登录）</span>
    </label>

    {#if error}<p class="err">{error}</p>{/if}
    {#if result}<pre class="result">{result}</pre>{/if}

  <!-- Plugins Tab -->
  {:else}
    <div class="plugins-wrap">
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
            {#if pluginsLoading}
              <tr><td colspan="4" class="state-cell">加载中…</td></tr>
            {:else if pluginsError}
              <tr><td colspan="4" class="state-cell err-cell">{pluginsError}</td></tr>
            {:else if plugins === null || plugins.length === 0}
              <tr><td colspan="4" class="state-cell">暂无插件，请在 plugins/ 目录添加 *.rssany.js 文件</td></tr>
            {:else}
              {#each plugins as plugin (plugin.id)}
                <tr>
                  <td class="td-id">{plugin.id}</td>
                  <td class="td-pattern">{plugin.listUrlPattern}</td>
                  <td class="td-caps">
                    {#if plugin.hasAuth}<span class="badge badge-auth">需要登录</span>{/if}
                    {#if plugin.hasParser}<span class="badge badge-parser">Parser</span>{/if}
                    {#if plugin.hasExtractor}<span class="badge badge-extractor">Extractor</span>{/if}
                    {#if !plugin.hasAuth && !plugin.hasParser && !plugin.hasExtractor}
                      <span class="empty-caps">—</span>
                    {/if}
                  </td>
                  <td class="td-actions">
                    {#if plugin.hasAuth}
                      <button
                        class="act-btn secondary"
                        on:click={() => checkAuth(plugin)}
                        disabled={checkingAuth.has(plugin.id)}
                      >{checkingAuth.has(plugin.id) ? '检查中…' : '检查登录'}</button>
                      <button
                        class="act-btn primary"
                        on:click={() => openLogin(plugin)}
                        disabled={openingLogin.has(plugin.id)}
                      >{openingLogin.has(plugin.id) ? '打开中…' : '打开登录页'}</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

{#if toast}
  <div class="toast {toastType}">{toast}</div>
{/if}

<style>
  .page {
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Tabs */
  .tabs {
    display: flex;
    border-bottom: 1px solid #e5e7eb;
    margin-bottom: 0.25rem;
  }
  .tabs button {
    padding: 0.55rem 1.25rem;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
    color: #888;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 0.15s, border-color 0.15s;
  }
  .tabs button:hover { color: #333; }
  .tabs button.active { color: #111; font-weight: 500; border-bottom-color: #111; }

  /* Description */
  .desc { font-size: 0.8125rem; color: #999; margin: 0; }

  /* Form */
  .form { display: flex; gap: 0.5rem; }
  .form input {
    flex: 1; padding: 0.6rem 0.875rem; border: 1px solid #ddd; border-radius: 7px;
    font-size: 0.875rem; font-family: inherit; outline: none; transition: border 0.15s;
    min-width: 0; background: #fff;
  }
  .form input:focus { border-color: #111; box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }
  .form button {
    padding: 0.6rem 1.25rem; background: #111; color: #fff; border: none; border-radius: 7px;
    cursor: pointer; font-size: 0.875rem; font-family: inherit; white-space: nowrap; transition: background 0.15s;
  }
  .form button:hover:not(:disabled) { background: #333; }
  .form button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Headful toggle */
  .headful-toggle {
    display: inline-flex; align-items: center; gap: 0.4rem;
    cursor: pointer; user-select: none; font-size: 0.8125rem; color: #555;
  }
  .headful-toggle input[type='checkbox'] { margin: 0; accent-color: #111; }
  .toggle-hint { font-size: 0.775rem; color: #bbb; }

  /* Error / Result */
  .err {
    font-size: 0.8125rem; color: #e53e3e; padding: 0.5rem 0.75rem;
    background: #fff5f5; border: 1px solid #fed7d7; border-radius: 6px; margin: 0;
  }
  .result {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 1rem 1.25rem; font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.775rem; line-height: 1.65; overflow-x: auto;
    white-space: pre-wrap; word-break: break-all; max-height: 60vh; overflow-y: auto; margin: 0;
  }

  /* Plugins table */
  .plugins-wrap { display: flex; flex-direction: column; gap: 0; }
  .table-wrap {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #fafafa; font-size: 0.75rem; font-weight: 600; color: #888;
    text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 1rem;
    text-align: left; border-bottom: 1px solid #f0f0f0;
  }
  tbody tr { border-bottom: 1px solid #f5f5f5; transition: background 0.1s; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: #fafafa; }
  td { padding: 0.75rem 1rem; font-size: 0.875rem; vertical-align: middle; }

  .td-id { font-weight: 600; color: #111; white-space: nowrap; }
  .td-pattern { font-family: monospace; font-size: 0.78rem; color: #555; word-break: break-all; max-width: 280px; }
  .td-caps { white-space: nowrap; }
  .td-actions { white-space: nowrap; text-align: right; }

  .badge {
    display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px;
    font-size: 0.72rem; font-weight: 500; margin-right: 0.25rem;
  }
  .badge-auth { background: #fff7e0; color: #92640a; border: 1px solid #f0d080; }
  .badge-parser { background: #e8f4fd; color: #0969da; border: 1px solid #b8dcf8; }
  .badge-extractor { background: #e6f9ee; color: #1a7f37; border: 1px solid #a8e6be; }
  .empty-caps { color: #ccc; font-size: 0.75rem; }

  .act-btn {
    display: inline-flex; align-items: center; padding: 0.35rem 0.7rem; border: none;
    border-radius: 5px; cursor: pointer; font-size: 0.8rem; font-family: inherit; transition: background 0.15s;
  }
  .act-btn.primary { background: #111; color: #fff; margin-left: 0.35rem; }
  .act-btn.primary:hover:not(:disabled) { background: #333; }
  .act-btn.secondary { background: #f0f0f0; color: #333; }
  .act-btn.secondary:hover:not(:disabled) { background: #e0e0e0; }
  .act-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .state-cell { text-align: center; color: #bbb; padding: 2rem; font-size: 0.875rem; }
  .err-cell { color: #c00; }

  /* Toast */
  .toast {
    position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
    background: #111; color: #fff; padding: 0.625rem 1.25rem; border-radius: 8px;
    font-size: 0.875rem; z-index: 100; white-space: nowrap; pointer-events: none;
  }
  .toast.error { background: #c0392b; }
  .toast.success { background: #1a7f37; }

  @media (max-width: 640px) {
    .td-pattern { display: none; }
    thead th:nth-child(2) { display: none; }
  }
</style>
