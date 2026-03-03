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
  <title>Admin - RssAny</title>
</svelte:head>

<div class="page">
  <h1 class="title">Admin</h1>
  <p class="sub">频道、插件、日志、MCP、Parse、Enrich 管理入口</p>

  {#if Object.keys(schedulerStats).length > 0}
    <section class="scheduler-section">
      <h2 class="section-title">调度任务</h2>
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

  .scheduler-section { margin-bottom: 1.5rem; }
  .section-title { font-size: 0.9375rem; font-weight: 600; margin: 0 0 0.5rem; }
  .group-card {
    padding: 0.75rem 1rem;
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 0.5rem;
  }
  .group-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.5rem; }
  .group-name { font-weight: 600; font-size: 0.875rem; }
  .group-meta { font-size: 0.75rem; color: #666; }
  .progress-bar {
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.2s;
  }
</style>
