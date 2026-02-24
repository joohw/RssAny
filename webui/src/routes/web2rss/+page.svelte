<script lang="ts">
  let urlInput = '';

  function go() {
    if (!urlInput.trim()) return;
    const fullUrl = urlInput.startsWith('http') ? urlInput : 'https://' + urlInput;
    window.open('/preview?url=' + encodeURIComponent(fullUrl), '_blank');
  }

  const examples = [
    { href: '/preview?url=' + encodeURIComponent('https://github.com/deepseek-ai'), label: 'GitHub deepseek-ai' },
    { href: '/preview?url=' + encodeURIComponent('https://openai.com/zh-Hans-CN/news/'), label: 'OpenAI News (中文)' },
    { href: '/preview?url=' + encodeURIComponent('https://lingowhale.com/channels?channel_id=67cc08b79a4297b6148b4c3f'), label: 'LingoWhale Channel' },
  ];
</script>

<svelte:head>
  <title>Web2RSS - RssAny</title>
</svelte:head>

<div class="main">
  <div class="hero">
    <h1 class="hero-title">Web2RSS</h1>
    <p class="hero-sub">将任意网页转换为 RSS 订阅源</p>
  </div>

  <div class="form-wrap">
    <form on:submit|preventDefault={go}>
      <div class="url-row">
        <input
          type="url"
          bind:value={urlInput}
          placeholder="输入网页地址…"
          required
          autocomplete="url"
        />
        <button type="submit">生成 RSS</button>
      </div>
    </form>
  </div>

  <div class="try-this">
    <p class="try-this-label">示例</p>
    <ul>
      {#each examples as ex}
        <li><a href={ex.href}>{ex.label}</a></li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .main {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 5rem 1.5rem 3rem;
  }
  .hero { text-align: center; margin-bottom: 2.5rem; }
  .hero-title {
    font-size: 2.25rem;
    font-weight: 800;
    letter-spacing: -0.05em;
    line-height: 1.15;
    margin-bottom: 0.75rem;
  }
  .hero-sub {
    font-size: 0.9375rem;
    color: #777;
  }

  .form-wrap { width: 100%; max-width: 520px; }
  .url-row { display: flex; gap: 0.5rem; }
  .url-row input {
    flex: 1;
    padding: 0.65rem 1rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 0.9375rem;
    outline: none;
    transition: border 0.15s;
    min-width: 0;
    background: #fff;
    font-family: inherit;
  }
  .url-row input:focus { border-color: #111; box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }
  .url-row button {
    padding: 0.65rem 1.375rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    font-family: inherit;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .url-row button:hover { background: #333; }

  .try-this {
    margin-top: 2.25rem;
    width: 100%;
    max-width: 520px;
  }
  .try-this-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: #bbb;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    margin-bottom: 0.5rem;
  }
  .try-this ul { list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
  .try-this a { color: #0969da; text-decoration: none; font-size: 0.875rem; }
  .try-this a:hover { text-decoration: underline; }

  @media (max-width: 600px) {
    .main { padding: 3rem 1rem 2rem; }
    .hero-title { font-size: 1.75rem; }
  }
</style>
