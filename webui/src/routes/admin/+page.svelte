<script lang="ts">
  // 开发工具入口：三个独立页面，无鉴权
  const links = [
    { href: '/parse', label: 'Parse', desc: '从列表页解析条目，返回 JSON' },
    { href: '/extractor', label: 'Enrich', desc: '从详情页提取正文，返回 JSON' },
    { href: '/plugins', label: '插件', desc: '已加载插件与登录状态' },
  ];
</script>

<svelte:head>
  <title>开发工具 - RssAny</title>
</svelte:head>

<div class="page">
  <h1 class="title">开发工具</h1>
  <p class="sub">Parse、Enrich、插件为独立页面，请从顶部导航进入</p>
  <div class="links">
    {#each links as link}
      <a class="card" href={link.href}>
        <span class="card-label">{link.label}</span>
        <span class="card-desc">{link.desc}</span>
      </a>
    {/each}
  </div>
</div>

<style>
  .page {
    max-width: 560px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  .title { font-size: 1.25rem; font-weight: 700; margin: 0 0 0.35rem; }
  .sub { font-size: 0.8125rem; color: #888; margin: 0 0 1.5rem; }

  .links { display: flex; flex-direction: column; gap: 0.5rem; }
  .card {
    display: block;
    padding: 0.875rem 1rem;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    text-decoration: none;
    color: #111;
    transition: border-color 0.15s, background 0.15s;
  }
  .card:hover { border-color: #d1d5db; background: #fafafa; }
  .card-label { font-weight: 600; font-size: 0.9375rem; display: block; margin-bottom: 0.2rem; }
  .card-desc { font-size: 0.8rem; color: #666; }
</style>
