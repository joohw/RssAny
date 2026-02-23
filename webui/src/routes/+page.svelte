<script lang="ts">
  // 首页：RSS 生成入口，输入 URL 跳转到 preview 页面
  let urlInput = '';
  let headful = false;

  function go() {
    if (!urlInput.trim()) return;
    const fullUrl = urlInput.startsWith('http') ? urlInput : 'https://' + urlInput;
    const base = '/preview?url=' + encodeURIComponent(fullUrl);
    window.open(base + (headful ? '&headless=false' : ''), '_blank');
  }
</script>

<svelte:head><title>RssAny</title></svelte:head>

<main class="main">
  <div class="hero">
    <h1 class="hero-title">RssAny</h1>
    <p class="hero-sub">将任意网页转换为 RSS 订阅源<br>支持自定义解析、正文提取与登录态管理</p>
  </div>

  <div class="form-wrap">
    <form on:submit|preventDefault={go}>
      <div class="url-row">
        <input type="url" bind:value={urlInput} placeholder="输入网页地址…" required autocomplete="url" />
        <button type="submit">生成 RSS</button>
      </div>
      <div class="form-opts">
        <label><input type="checkbox" bind:checked={headful} /> Headful</label>
        <span class="hint">勾选后可观察实际加载过程</span>
      </div>
    </form>
  </div>

  <div class="try-this">
    <p class="try-this-label">示例</p>
    <ul>
      <li><a href="/preview?url=https%3A%2F%2Fgithub.com%2Fdeepseek-ai">GitHub deepseek-ai</a></li>
      <li><a href="/preview?url=https%3A%2F%2Fopenai.com%2Fzh-Hans-CN%2Fnews%2F">OpenAI News (中文)</a></li>
      <li><a href="/preview?url=https%3A%2F%2Flingowhale.com%2Fchannels%3Fchannel_id%3D67cc08b79a4297b6148b4c3f">LingoWhale Channel</a></li>
    </ul>
  </div>

  <div class="dev-tools">
    <span class="dev-tools-label">开发工具</span>
    <a href="/parse">Parse</a>
    <a href="/extractor">Extract</a>
  </div>
</main>

<style>
  .main { display: flex; flex-direction: column; align-items: center; padding: 5rem 1.5rem 3rem }
  .hero { text-align: center; margin-bottom: 2.5rem }
  .hero-title { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.05em; line-height: 1.15; margin-bottom: 0.75rem }
  .hero-sub { font-size: 0.9375rem; color: #777; line-height: 1.65; max-width: 400px; margin: 0 auto }
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
  .try-this { margin-top: 2.25rem; width: 100%; max-width: 520px }
  .try-this-label { font-size: 0.7rem; font-weight: 600; color: #bbb; text-transform: uppercase; letter-spacing: 0.09em; margin-bottom: 0.5rem }
  .try-this ul { list-style: none; display: flex; flex-direction: column; gap: 0.3rem }
  .try-this a { color: #0969da; text-decoration: none; font-size: 0.875rem }
  .try-this a:hover { text-decoration: underline }
  .dev-tools { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e8e8e8; width: 100%; max-width: 520px; display: flex; align-items: center; gap: 0.5rem }
  .dev-tools-label { font-size: 0.775rem; color: #bbb }
  .dev-tools a { font-size: 0.8rem; color: #888; text-decoration: none; padding: 0.2rem 0.6rem; border: 1px solid #e0e0e0; border-radius: 5px; transition: all 0.15s }
  .dev-tools a:hover { color: #111; border-color: #aaa }
  @media (max-width: 600px) { .main { padding: 3rem 1rem 2rem } .hero-title { font-size: 1.75rem } }
</style>
