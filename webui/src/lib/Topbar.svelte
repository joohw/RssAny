<script lang="ts">
  // 顶栏组件：品牌 + GitHub 图标 + 主导航，active 状态自动跟随当前路径
  import { page } from '$app/stores';

  const navLinks = [
    { href: '/feed', label: '信息流' },
    { href: '/subscriptions', label: '订阅管理' },
    { href: '/sites', label: '站点配置' },
    { href: '/plugins', label: '插件' },
  ];
</script>

<header class="topbar">
  <a class="brand" href="/">RssAny</a>
  <a class="github" href="https://github.com/joohw/RssAny" target="_blank" rel="noopener" title="GitHub">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  </a>
  <nav class="nav">
    {#each navLinks as link}
      <a href={link.href} class:active={$page.url.pathname === link.href}>{link.label}</a>
    {/each}
  </nav>
</header>

<style>
  .topbar {
    height: 48px;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    padding: 0 1.25rem;
    gap: 0.5rem;
    position: sticky;
    top: 0;
    z-index: 30;
  }
  .brand {
    font-size: 1rem;
    font-weight: 700;
    color: #111;
    text-decoration: none;
    letter-spacing: -0.02em;
    margin-right: 0.125rem;
  }
  .github {
    display: flex;
    align-items: center;
    color: #ccc;
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .github:hover { color: #111 }
  .nav {
    display: flex;
    gap: 1rem;
    margin-left: auto;
    align-items: center;
  }
  .nav a {
    font-size: 0.8125rem;
    color: #555;
    text-decoration: none;
    padding: 0.25rem 0;
    transition: color 0.15s;
  }
  .nav a:hover { color: #111 }
  .nav a.active { color: #111; font-weight: 500 }
</style>
