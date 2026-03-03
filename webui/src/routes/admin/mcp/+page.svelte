<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  const fallbackOrigin = 'http://127.0.0.1:3751';
  let origin = typeof window !== 'undefined' ? $page.url.origin : fallbackOrigin;
  let mcpConfigSnippet: { mcpServers: { rssany: { type: string; url: string } } } = {
    mcpServers: {
      rssany: {
        type: 'streamableHttp',
        url: `${origin}/mcp`
      }
    }
  };

  onMount(async () => {
    try {
      const res = await fetch('/api/server-info');
      const info = await res.json() as { lanUrl?: string | null };
      if (info.lanUrl) {
        origin = info.lanUrl;
        mcpConfigSnippet = {
          mcpServers: {
            rssany: { type: 'streamableHttp', url: `${origin}/mcp` }
          }
        };
      }
    } catch (_) {}
  });
</script>

<svelte:head>
  <title>MCP 接入 - RssAny</title>
</svelte:head>

<div class="feed-wrap mcp-wrap">
  <div class="feed-col mcp-col">
    <div class="card mcp-card">
      <h1 class="page-title">MCP 接入</h1>
      <p class="intro">
        RssAny 提供 <strong>MCP</strong>（Model Context Protocol）服务，可在支持 MCP 的 IDE 中接入，
        使用频道列表、信息流、条目详情、全文搜索等工具。
      </p>

      <section class="section">
        <h2>前置条件</h2>
        <ul>
          <li>RssAny 服务已启动（局域网地址 <code>{origin}</code>）</li>
          <li>安装并使用支持 MCP 的客户端：Claude Code、Codex、Cursor</li>
        </ul>
      </section>

      <section class="section">
        <h2>客户端支持</h2>
        <ul>
          <li><strong>Claude Code</strong>：在设置中添加 MCP 连接，类型选择 Streamable HTTP，<code>url</code> 填写 <code>{origin}/mcp</code></li>
          <li><strong>Codex</strong>：在设置中添加 MCP 连接，类型选择 Streamable HTTP，<code>url</code> 填写 <code>{origin}/mcp</code></li>
          <li><strong>Cursor</strong>：支持 MCP Streamable HTTP，在配置文件中加入以下片段</li>
        </ul>
      </section>

      <section class="section">
        <h2>配置示例</h2>
        <p>在项目或用户目录下创建/编辑 <code>.cursor/mcp.json</code>，加入：</p>
        <pre class="code-block"><code>{JSON.stringify(mcpConfigSnippet, null, 2)}</code></pre>
        <p class="hint">将 <code>url</code> 改为你的 RssAny 服务地址（含 <code>/mcp</code> 路径）。</p>
      </section>

      <section class="section">
        <h2>可用工具</h2>
        <ul class="tools-list">
          <li><code>list_channels</code> — 列出所有频道（id、标题、描述）</li>
          <li><code>get_channel_feeds</code> — 获取指定频道或全部的信息流（可选 channel_id、limit、offset）</li>
          <li><code>get_feed_detail</code> — 根据条目 id 获取单条完整详情（含正文）</li>
          <li><code>search_feeds</code> — 全文搜索（title/summary/content），可选 source_url、分页</li>
        </ul>
      </section>
    </div>
  </div>
</div>

<style>
  .mcp-wrap {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding-top: 1rem; /* 添加顶部边距 */
  }
  .mcp-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .mcp-card { max-width: none; }
  .page-title { font-size: 1.25rem; margin-bottom: 0.75rem; }
  .intro { color: #444; margin-bottom: 1.5rem; line-height: 1.5; }
  .section { margin-bottom: 1.5rem; }
  .section h2 { font-size: 1rem; margin-bottom: 0.5rem; color: #111; }
  .section ul { margin: 0.25rem 0 0 1rem; padding: 0; }
  .section li { margin-bottom: 0.25rem; }
  .code-block {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    overflow-x: auto;
    position: relative;
  }
  .code-block.wrap { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .code-block.wrap code { flex: 1; min-width: 0; word-break: break-all; }
  .hint { font-size: 0.8125rem; color: #666; margin-top: 0.5rem; }
  .tools-list { list-style: none; margin-left: 0; }
  .tools-list li { margin-bottom: 0.5rem; }
  .tools-list code { background: #eee; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.875em; }

  @media (max-width: 600px) {
    .mcp-wrap { max-width: 100%; }
    .mcp-col { border: none; }
  }
</style>
