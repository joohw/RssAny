<script lang="ts">
  import { page } from '$app/stores';
  // 预加载 session store，确保切换页面时模块不被卸载
  import '$lib/agentSession';

  interface NavLink { href: string; label: string }

  const navLinks: NavLink[] = [
    { href: '/feeds?channel=all', label: 'Feeds' },
    { href: '/tags', label: 'Topics' },
    { href: '/sources', label: 'Sources' },
    { href: '/agent', label: 'Ask' },
  ];

  function isActive(link: NavLink, pathname: string): boolean {
    if (link.href.startsWith('/feeds')) return pathname === '/feeds';
    if (link.href === '/agent') return pathname.startsWith('/agent');
    if (link.href === '/tags') return pathname.startsWith('/tags') || pathname.startsWith('/topics');
    return pathname.startsWith(link.href);
  }
</script>

<div class="topbar">
  <nav class="topbar-nav">
    {#each navLinks as link}
      <a
        href={link.href}
        class:active={isActive(link, $page.url.pathname)}
      >{link.label}</a>
    {/each}
  </nav>
  <a href="/admin" class="topbar-settings" class:active={$page.url.pathname.startsWith('/admin')} title="设置" aria-label="设置">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  </a>
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
    justify-content: space-between;
    padding: 0 1.25rem;
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .topbar-nav {
    display: flex;
    gap: 1.25rem;
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
  .topbar-settings {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    padding: 0.35rem;
    border-radius: 6px;
  }
  .topbar-settings:hover,
  .topbar-settings.active {
    color: #111;
    background: #f3f4f6;
  }
</style>
