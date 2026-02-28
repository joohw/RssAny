<script lang="ts">
  import { page } from '$app/stores';

  interface NavLink { href: string; label: string }

  const allLinks: NavLink[] = [
    { href: '/channels/all', label: '信息流' },
    { href: '/sources', label: '信源' },
    { href: '/channels', label: '频道' },
    { href: '/logs', label: '日志' },
    { href: '/parse', label: 'Parse' },
    { href: '/extractor', label: 'Enrich' },
    { href: '/plugins', label: '插件' },
  ];

  // 信息流：/channels/xxx（含 /channels/all）；频道配置：仅 /channels
  function isActive(link: NavLink, pathname: string): boolean {
    if (link.href === '/channels/all') {
      return pathname.startsWith('/channels/');
    }
    if (link.href === '/channels') {
      return pathname === '/channels';
    }
    return pathname.startsWith(link.href);
  }
</script>

<div class="topbar">
  <a class="topbar-brand" href="/channels/all">RssAny</a>
  <nav class="topbar-nav">
    {#each allLinks as link}
      <a
        href={link.href}
        class:active={isActive(link, $page.url.pathname)}
      >{link.label}</a>
    {/each}
  </nav>
</div>

<slot />

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: system-ui, -apple-system, sans-serif;
    background: #f5f5f5;
    color: #111;
  }

  .topbar {
    height: 48px;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    padding: 0 1.25rem;
    gap: 1.5rem;
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .topbar-brand {
    font-size: 1rem;
    font-weight: 700;
    color: #111;
    text-decoration: none;
    letter-spacing: -0.02em;
  }
  .topbar-nav {
    display: flex;
    gap: 1rem;
    margin-left: auto;
    align-items: center;
  }
  .topbar-nav a {
    font-size: 0.8125rem;
    color: #555;
    text-decoration: none;
    padding: 0.25rem 0;
  }
  .topbar-nav a:hover { color: #111; }
  .topbar-nav a.active { color: #111; font-weight: 500; }
</style>
