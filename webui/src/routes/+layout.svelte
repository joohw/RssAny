<script lang="ts">
  import { page } from '$app/stores';

  interface NavLink { href: string; label: string }

  const allLinks: NavLink[] = [
    { href: '/', label: '信息流' },
    { href: '/web2rss', label: 'Web2RSS' },
    { href: '/subscriptions', label: '订阅管理' },
    { href: '/admin', label: 'Admin' },
  ];
</script>

<div class="topbar">
  <a class="topbar-brand" href="/">RssAny</a>
  <nav class="topbar-nav">
    {#each allLinks as link}
      <a
        href={link.href}
        class:active={$page.url.pathname.startsWith(link.href) && (link.href !== '/' || $page.url.pathname === '/')}
        class:admin={link.href === '/admin'}
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
  .topbar-nav a.admin { color: #999; font-size: 0.75rem; }
  .topbar-nav a.admin:hover { color: #555; }
  .topbar-nav a.admin.active { color: #555; }
</style>
