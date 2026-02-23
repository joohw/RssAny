<script lang="ts">
  // Parse 开发工具页面：调用 /parse/{url}，验证 Parser 插件规则
  let urlInput = '';
  let headful = false;

  function go() {
    if (!urlInput.trim()) return;
    const fullUrl = urlInput.startsWith('http') ? urlInput : 'https://' + urlInput;
    window.open('/parse/' + encodeURIComponent(fullUrl) + (headful ? '?headless=false' : ''), '_blank');
  }
</script>

<svelte:head><title>Parse - RssAny</title></svelte:head>

<main class="main">
  <div class="hero">
    <p class="hero-eyebrow">开发工具</p>
    <h1 class="hero-title">Parse</h1>
    <p class="hero-sub">从列表页解析条目结构，返回 JSON，用于调试插件 Parser 规则</p>
  </div>

  <div class="form-wrap">
    <form on:submit|preventDefault={go}>
      <div class="url-row">
        <input type="url" bind:value={urlInput} placeholder="输入列表页地址…" required autocomplete="url" />
        <button type="submit">解析</button>
      </div>
      <div class="form-opts">
        <label><input type="checkbox" bind:checked={headful} /> Headful</label>
        <span class="hint">勾选后可观察实际加载过程</span>
      </div>
    </form>
  </div>

  <div class="info-box" style="margin-top:2rem;max-width:520px">
    调用 <code>GET /parse/{'{url}'}</code>，使用站点插件的自定义 Parser（若有），否则回退到 LLM 解析。返回条目列表 JSON，可用于验证 Parser 规则是否正确识别标题、链接、摘要等字段。
  </div>
</main>

<style>
  .main { display: flex; flex-direction: column; align-items: center; padding: 4rem 1.5rem 3rem }
  .hero { text-align: center; margin-bottom: 2.25rem }
  .hero-eyebrow { font-size: 0.75rem; font-weight: 600; color: #bbb; text-transform: uppercase; letter-spacing: 0.09em; margin-bottom: 0.5rem }
  .hero-title { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.04em; margin-bottom: 0.6rem }
  .hero-sub { font-size: 0.9rem; color: #777; line-height: 1.6; max-width: 400px; margin: 0 auto }
  .form-wrap { width: 100%; max-width: 520px }
  .url-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem }
  .url-row input { flex: 1; padding: 0.65rem 1rem; border: 1px solid #ddd; border-radius: 8px; font-size: 0.9375rem; outline: none; transition: border 0.15s; min-width: 0; background: #fff }
  .url-row input:focus { border-color: #111; box-shadow: 0 0 0 3px rgba(0,0,0,0.06) }
  .url-row button { padding: 0.65rem 1.375rem; background: #111; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-family: inherit; white-space: nowrap; transition: background 0.15s }
  .url-row button:hover { background: #333 }
  .form-opts { display: flex; align-items: center; gap: 0.5rem; padding-left: 0.25rem }
  .form-opts label { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; cursor: pointer; color: #666; user-select: none }
  .form-opts input[type=checkbox] { margin: 0; accent-color: #111 }
  .hint { font-size: 0.775rem; color: #bbb }
  @media (max-width: 600px) { .main { padding: 2.5rem 1rem 2rem } }
</style>
