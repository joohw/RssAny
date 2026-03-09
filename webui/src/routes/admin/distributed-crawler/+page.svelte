<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  const fallbackOrigin = 'http://127.0.0.1:3751';
  let origin = typeof window !== 'undefined' ? $page.url.origin : fallbackOrigin;
  $: gatewayUrl = `${origin}/api/gateway/items`;
  $: curlExample = `curl -X POST ${origin}/api/gateway/items \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceRef": "my-crawler",
    "items": [
      {
        "title": "文章标题",
        "link": "https://example.com/article/1",
        "pubDate": "2025-03-03T12:00:00Z",
        "summary": "摘要",
        "content": "正文（可选）"
      }
    ]
  }'`;

  onMount(async () => {
    try {
      const res = await fetch('/api/server-info');
      const info = await res.json() as { lanUrl?: string | null };
      if (info.lanUrl) origin = info.lanUrl;
    } catch (_) {}
  });
</script>

<svelte:head>
  <title>分布式爬虫 - RssAny</title>
</svelte:head>

<div class="feed-wrap">
  <div class="feed-col">
    <div class="body">
      <p class="intro">
        外部爬虫或分布式抓取服务可通过 <strong>POST</strong> 将条目推送到当前服务器，经 Pipeline（打标签、翻译等）后入库。
      </p>

      <section class="doc-section">
        <h3 class="section-title">当前服务器接收端点</h3>
        <p class="doc-p">将分布式爬虫的 POST 目标修改为：</p>
        <pre class="code-block"><code>{gatewayUrl}</code></pre>
        <p class="hint">若通过局域网访问，请使用实际服务地址（如 <code>{origin}</code>）。</p>
      </section>

      <section class="doc-section">
        <h3 class="section-title">请求格式</h3>
        <p class="doc-p">请求体为 JSON，字段说明：</p>
        <ul class="doc-list">
          <li><code>items</code>（必填）— FeedItem 数组，每项需含 <code>title</code>、<code>link</code>、<code>pubDate</code>，可选 <code>summary</code>、<code>content</code>、<code>author</code> 等</li>
          <li><code>sourceRef</code>（可选）— 信源标识，默认 <code>gateway</code></li>
          <li><code>writeDb</code>（可选）— 是否入库，默认 <code>true</code></li>
        </ul>
      </section>

      <section class="doc-section">
        <h3 class="section-title">调用示例</h3>
        <pre class="code-block"><code>{curlExample}</code></pre>
        <p class="hint">将 URL 中的地址改为当前服务器实际地址。</p>
      </section>

      <section class="doc-section">
        <h3 class="section-title">入库后投递到远端</h3>
        <p class="doc-p">在 <a href="/admin/deliver">投递设置</a> 中配置目标 URL 后，入库完成会自动将条目 POST 到该地址。</p>
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
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .body::-webkit-scrollbar { width: 4px; }
  .body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

  .intro { color: #444; margin: 0 0 1.25rem; line-height: 1.5; font-size: 0.875rem; }
  .section-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #6b7280;
    margin: 0 0 0.5rem;
  }
  .doc-section { margin-bottom: 1.25rem; }
  .doc-list { margin: 0.25rem 0 0 1rem; padding: 0; }
  .doc-list li { margin-bottom: 0.35rem; font-size: 0.8125rem; line-height: 1.5; }
  .doc-p { margin: 0 0 0.5rem; font-size: 0.8125rem; line-height: 1.5; }
  .code-block {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    color: #374151;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .hint { font-size: 0.75rem; color: #9ca3af; margin: 0.5rem 0 0; }

  @media (max-width: 600px) {
    .feed-wrap { max-width: 100%; }
    .feed-col { border: none; }
  }
</style>
