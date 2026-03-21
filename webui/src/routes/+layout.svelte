<script lang="ts">
  /// <reference path="../lucide-svelte.d.ts" />
  import { page } from '$app/stores';
  import Rss from 'lucide-svelte/icons/rss';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import ListTodo from 'lucide-svelte/icons/list-todo';
  import List from 'lucide-svelte/icons/list';
  import MessageCircle from 'lucide-svelte/icons/message-circle';
  import Settings from 'lucide-svelte/icons/settings';
  import '$lib/agentSession';
  import '../app.css';

  interface NavLink { href: string; label: string; Icon: import('svelte').ComponentType }
  const navLinks: NavLink[] = [
    { href: '/agent', label: 'Ask', Icon: MessageCircle },
    { href: '/agent-tasks', label: 'Tasks', Icon: ListTodo },
    { href: '/feeds?channel=all', label: 'Feeds', Icon: Rss },
    { href: '/folders', label: 'Folders', Icon: FolderOpen },
    { href: '/sources', label: 'Sources', Icon: List },
  ];

  function isActive(link: NavLink, pathname: string): boolean {
    if (link.href.startsWith('/feeds')) return pathname === '/feeds';
    if (link.href === '/agent')
      return pathname === '/agent' || pathname.startsWith('/agent/');
    if (link.href === '/folders') return pathname.startsWith('/folders');
    if (link.href === '/agent-tasks') return pathname.startsWith('/agent-tasks');
    return pathname.startsWith(link.href);
  }
</script>

<div class="layout-outer">
  <div class="layout-inner">
    <aside class="sidebar">
      <nav class="sidebar-nav">
        {#each navLinks as link}
          <a
            href={link.href}
            class="sidebar-link {isActive(link, $page.url.pathname) ? 'sidebar-link-active' : ''}"
            title={link.label}
            aria-label={link.label}
          >
            <span class="sidebar-icon"><svelte:component this={link.Icon} size={20} /></span>
          </a>
        {/each}
      </nav>
      <a href="/admin" class="sidebar-settings" title="设置" aria-label="设置">
        <span class="sidebar-icon"><Settings size={20} /></span>
      </a>
    </aside>
    <main class="main">
      <slot />
    </main>
  </div>
</div>

<style>
  :global(:root) {
    --color-primary: #111111;
    --color-primary-hover: #333333;
    --color-primary-light: #f0f0f0;
    --color-primary-foreground: #fff;
    --color-background: #f5f5f5;
    --color-foreground: #111;
    --color-card: #fff;
    --color-card-foreground: #111;
    --color-muted: #f3f4f6;
    --color-muted-foreground: #6b7280;
    --color-muted-foreground-strong: #374151;
    --color-muted-foreground-soft: #9ca3af;
    --color-accent: #eee;
    --color-accent-foreground: #111;
    --color-border: #e5e7eb;
    --color-border-muted: #d1d5db;
    --color-input: #d1d5db;
    --color-destructive: #c53030;
    --color-destructive-foreground: #fff;
    --color-success: #22c55e;
    --color-success-foreground: #fff;
  }
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: system-ui, -apple-system, sans-serif;
    background: var(--color-background);
    color: var(--color-foreground);
    width: 100%;
  }
  /* 仅对无 class 的 button 应用默认样式，带 class 的（含 Tailwind）由各自样式控制 */
  :global(button:not([class])),
  :global(button[class='']) {
    font: inherit;
    cursor: pointer;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: var(--color-background);
    color: var(--color-foreground);
  }
  :global(button:not([class]):hover:not(:disabled)),
  :global(button[class='']:hover:not(:disabled)) {
    background: var(--color-accent);
    border-color: var(--color-muted-foreground-soft);
  }
  :global(button:not([class]):disabled),
  :global(button[class='']:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 外层占满宽，保证内层 mx-auto 能居中 */
  .layout-outer {
    width: 100%;
    min-height: 100vh;
  }
  .layout-inner {
    display: flex;
    min-height: 100vh;
    max-width: 776px;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
  .sidebar {
    width: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem 0;
    gap: 0.5rem;
    z-index: 20;
    background: var(--color-card);
    border: 1px solid var(--color-border);
  }
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    align-items: center;
  }
  .sidebar-link {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted-foreground);
    text-decoration: none;
    padding: 0.5rem;
    border-radius: 8px;
  }
  .sidebar-link:hover {
    color: var(--color-primary);
    background: var(--color-muted);
  }
  .sidebar-link-active {
    color: var(--color-primary);
    background: var(--color-muted);
  }
  /* 图标固定尺寸，避免被 Tailwind preflight 或 flex 压缩 */
  .sidebar-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }
  .sidebar-icon :global(svg) {
    width: 20px;
    height: 20px;
  }
  .sidebar-settings {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted-foreground);
    padding: 0.5rem;
    border-radius: 8px;
  }
  .sidebar-settings:hover {
    color: var(--color-primary);
    background: var(--color-muted);
  }
  .main {
    flex: 1;
    min-width: 0;
    min-height: 100vh;
    max-width: 720px;
  }
</style>
