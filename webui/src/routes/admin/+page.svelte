<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface GroupStats {
    running: number;
    queued: number;
    concurrency: number;
    scheduledCount: number;
  }

  const links = [
    { href: '/admin/channels', label: '频道', desc: 'channels.json 配置编辑' },
    { href: '/admin/plugins', label: '插件', desc: '已加载插件与登录状态' },
    { href: '/admin/logs', label: '日志', desc: '系统运行日志' },
    { href: '/admin/mcp', label: 'MCP', desc: 'MCP 接入配置说明' },
    { href: '/admin/parse', label: 'Parse', desc: '从列表页解析条目，返回 JSON' },
    { href: '/admin/extractor', label: 'Enrich', desc: '从详情页提取正文，返回 JSON' },
  ];

  let schedulerStats: Record<string, GroupStats> = {};
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function fetchSchedulerStats() {
    try {
      const r = await fetch('/api/scheduler/stats');
      const text = await r.text();
      schedulerStats = text.trim() ? JSON.parse(text) : {};
    } catch {
      schedulerStats = {};
    }
  }

  onMount(() => {
    fetchSchedulerStats();
    pollTimer = setInterval(fetchSchedulerStats, 2000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<svelte:head>
  <title>设置 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="feed-header">
      <h2>设置</h2>
      <p class="sub">频道、插件、日志、MCP、Parse、Enrich 管理入口</p>
    </div>

    <div class="body">
      {#if Object.keys(schedulerStats).length > 0}
        <section class="scheduler-section">
          <h3 class="section-title">调度任务</h3>
          {#each Object.entries(schedulerStats) as [groupName, stats]}
            <div class="group-card">
              <div class="group-header">
                <span class="group-name">{groupName}</span>
                <span class="group-meta">
                  执行中 {stats.running}/{stats.concurrency} · 排队 {stats.queued}
                  {#if stats.scheduledCount > 0}
                    · 定时 {stats.scheduledCount}
                  {/if}
                </span>
              </div>
              <div class="progress-bar" role="progressbar" aria-valuenow={stats.running} aria-valuemin={0} aria-valuemax={stats.concurrency}>
                <div class="progress-fill" style="width: {(stats.running / stats.concurrency) * 100}%"></div>
              </div>
            </div>
          {/each}
        </section>
      {/if}

      <section class="links-section">
        <h3 class="section-title">管理</h3>
        <div class="links">
          {#each links as link}
            <a class="card" href={link.href}>
              <div class="card-main">
                <span class="card-label">{link.label}</span>
                <span class="card-desc">{link.desc}</span>
              </div>
              <span class="card-arrow">›</span>
            </a>
          {/each}
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .feed-wrap {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .feed-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }
  .feed-header {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .feed-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }
  .sub {
    font-size: 0.75rem;
    color: #aaa;
    margin: 0;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .body::-webkit-scrollbar { width: 4px; }
  .body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .section-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #6b7280;
    margin: 0 0 0.5rem;
  }
  .scheduler-section {
    margin-bottom: 1.25rem;
  }
  .group-card {
    padding: 0.75rem 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin-bottom: 0.5rem;
  }
  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .group-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: #111;
  }
  .group-meta {
    font-size: 0.75rem;
    color: #6b7280;
  }
  .progress-bar {
    height: 4px;
    background: #e5e7eb;
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #0969da;
    border-radius: 2px;
    transition: width 0.2s;
  }

  .links-section {
    margin-bottom: 0.5rem;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }
  .card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    text-decoration: none;
    transition: background 0.15s;
  }
  .card:last-child {
    border-bottom: none;
  }
  .card:hover {
    background: #fafafa;
  }
  .card-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .card-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #111;
    line-height: 1.4;
  }
  .card:hover .card-label {
    color: #0969da;
  }
  .card-desc {
    font-size: 0.75rem;
    color: #888;
    line-height: 1.3;
  }
  .card-arrow {
    font-size: 1rem;
    color: #9ca3af;
    flex-shrink: 0;
  }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
