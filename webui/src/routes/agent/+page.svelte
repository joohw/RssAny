<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { marked } from 'marked';
  import { agentMessages, rehydrateAgentMessages } from '$lib/agentSession';

  marked.setOptions({ breaks: true, gfm: true });

  function preprocessTableMarkdown(text: string): string {
    let out = text;
    out = out.replace(/```[\w]*\n([\s\S]*?)```/g, (match, code) => {
      const trimmed = code.trim();
      if (/^\|.+\|\s*\n\s*\|[-:\s|]+\|\s*\n/m.test(trimmed)) return trimmed;
      return match;
    });
    out = out.replace(/^(\s{2,})\|/gm, '|');
    return out;
  }

  function renderMd(text: string): string {
    const preprocessed = preprocessTableMarkdown(text);
    let html = marked.parse(preprocessed) as string;
    html = html.replace(/<a href=/gi, '<a target="_blank" rel="noopener noreferrer" href=');
    html = html.replace(/<table(\s[^>]*)?>/g, '<div class="table-wrap"><table$1>').replace(/<\/table>/g, '</table></div>');
    return html;
  }

  interface ToolCall {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
  }

  interface TokenUsage {
    input: number;
    output: number;
    totalTokens: number;
    cost?: { total: number };
  }

  type AgentMessage = import('$lib/agentSession').AgentMessage;

  const TOOL_LABELS: Record<string, string> = {
    list_channels: '列出频道',
    get_channel_feeds: '获取 feeds',
    get_feed_detail: '获取详情',
    search_feeds: '搜索/筛选',
    web_search: '网页搜索',
    web_fetch: '抓取网页',
  };

  const QUICK_PROMPTS = [
    '有哪些频道？',
    '科技频道最新 5 条',
    '搜索「AI」相关文章',
  ];

  function toolLabel(name: string): string {
    return TOOL_LABELS[name] ?? name;
  }

  function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  }

  function formatUsage(u: TokenUsage): string {
    const parts: string[] = [];
    if (u.totalTokens > 0) parts.push(`${u.totalTokens} tokens`);
    if (u.cost?.total != null && u.cost.total > 0) parts.push(`$${u.cost.total.toFixed(4)}`);
    return parts.join(' · ');
  }

  let input = '';
  let inputEl: HTMLTextAreaElement | null = null;
  let messagesEl: HTMLDivElement | null = null;
  let streaming = false;

  let scrollIntervalId: ReturnType<typeof setInterval> | null = null;
  let userScrolledUp = false;
  let scrollCleanup: (() => void) | null = null;

  $: if (messagesEl) {
    if (scrollCleanup) scrollCleanup();
    const el = messagesEl;
    const onScroll = () => {
      if (!streaming || !el) return;
      const { scrollTop, clientHeight, scrollHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 24;
      if (!atBottom) userScrolledUp = true;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    scrollCleanup = () => {
      el.removeEventListener('scroll', onScroll);
      scrollCleanup = null;
    };
  }

  let prevStreaming = false;
  $: {
    if (streaming && !prevStreaming) userScrolledUp = false;
    prevStreaming = streaming;
  }
  $: if (streaming && messagesEl) {
    const scrollToBottom = () => {
      if (!userScrolledUp && messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    scrollToBottom();
    if (scrollIntervalId) clearInterval(scrollIntervalId);
    scrollIntervalId = setInterval(scrollToBottom, 800);
  } else if (scrollIntervalId) {
    clearInterval(scrollIntervalId);
    scrollIntervalId = null;
  }

  onDestroy(() => {
    if (scrollCleanup) scrollCleanup();
  });

  onMount(() => {
    rehydrateAgentMessages();
    inputEl?.focus();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'N' && e.shiftKey && $agentMessages.length > 0 && !streaming) {
        e.preventDefault();
        clearChat();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });
  let streamContent = '';
  let streamToolCalls: ToolCall[] = [];
  let error = '';

  async function send(promptText?: string) {
    const prompt = (promptText ?? input.trim()).trim();
    if (!prompt || streaming) return;
    if (!promptText) input = '';
    const history = $agentMessages.map((m) =>
      m.role === "user" ? { role: m.role as const, content: m.content } : { role: m.role as const, content: m.content, usage: m.usage }
    );
    agentMessages.update((m) => [...m, { role: 'user', content: prompt }]);
    streaming = true;
    streamContent = '';
    streamToolCalls = [];
    error = '';
    let lastUsage: TokenUsage | undefined;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, messages: history }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无响应流');
      const decoder = new TextDecoder();
      let buf = '';
      let lastEvent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (lastEvent === 'text_delta' && data.delta !== undefined) {
                streamContent += data.delta;
              }
              if (lastEvent === 'tool_start' && data.toolName) {
                streamToolCalls = [...streamToolCalls, { toolCallId: data.toolCallId ?? '', toolName: data.toolName, args: data.args ?? {}, status: 'running' }];
              }
              if (lastEvent === 'tool_end' && data.toolCallId) {
                streamToolCalls = streamToolCalls.map((t) =>
                  t.toolCallId === data.toolCallId ? { ...t, status: data.isError ? 'error' : 'success' } : t
                );
              }
              if (lastEvent === 'error' && data.message) {
                error = data.message;
              }
              if (lastEvent === 'done' && data.usage) {
                lastUsage = data.usage;
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      streaming = false;
      if (streamContent || error || streamToolCalls.length > 0) {
        agentMessages.update((m) => [
          ...m,
          {
            role: 'assistant',
            content: error || streamContent || '(无回复)',
            toolCalls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
            usage: lastUsage,
          },
        ]);
      }
      streamContent = '';
      streamToolCalls = [];
    }
  }

  function clearChat() {
    agentMessages.clear();
    error = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<svelte:head>
  <title>Ask - RssAny</title>
</svelte:head>

<div class="wrap">
  <div class="col">
    <div class="agent-messages" bind:this={messagesEl}>
      {#if $agentMessages.length === 0}
        <div class="agent-empty">
          <p class="agent-empty-title">向 Ask 提问</p>
          <p class="agent-empty-desc">综合运用各种工具，挖掘已有的信息、feeds 等</p>
          <div class="quick-prompts">
            {#each QUICK_PROMPTS as prompt}
              <button
                type="button"
                class="quick-prompt"
                on:click={() => send(prompt)}
                disabled={streaming}
              >
                {prompt}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        {#each $agentMessages as msg, i (i + msg.role + msg.content + JSON.stringify(msg.toolCalls ?? []))}
          <div class="msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
            <span class="msg-role">{msg.role === 'user' ? '你' : 'Ask'}</span>
            {#if msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0}
              <div class="tool-calls">
                {#each msg.toolCalls as tc (tc.toolCallId + tc.status)}
                  <div class="tool-call" class:running={tc.status === 'running'} class:success={tc.status === 'success'} class:error={tc.status === 'error'}>
                    <span class="tool-call-icon">
                      {#if tc.status === 'running'}⟳
                      {:else if tc.status === 'success'}✓
                      {:else}✗
                      {/if}
                    </span>
                    <span class="tool-call-name">{toolLabel(tc.toolName)}</span>
                    {#if formatArgs(tc.args)}
                      <span class="tool-call-args">{formatArgs(tc.args)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            {#if msg.role === 'assistant'}
              <div class="msg-content markdown-body">{@html renderMd(msg.content)}</div>
              {#if msg.usage}
                <div class="msg-usage">{formatUsage(msg.usage)}</div>
              {/if}
            {:else}
              <div class="msg-content">{msg.content}</div>
            {/if}
          </div>
        {/each}
        {#if streaming}
          <div class="msg assistant">
            <span class="msg-role">Ask</span>
            {#if streamToolCalls.length > 0}
              <div class="tool-calls">
                {#each streamToolCalls as tc (tc.toolCallId + tc.status)}
                  <div class="tool-call" class:running={tc.status === 'running'} class:success={tc.status === 'success'} class:error={tc.status === 'error'}>
                    <span class="tool-call-icon">
                      {#if tc.status === 'running'}⟳
                      {:else if tc.status === 'success'}✓
                      {:else}✗
                      {/if}
                    </span>
                    <span class="tool-call-name">{toolLabel(tc.toolName)}</span>
                    {#if formatArgs(tc.args)}
                      <span class="tool-call-args">{formatArgs(tc.args)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <div class="msg-content markdown-body">
              {@html renderMd(streamContent)}<span class="cursor">▌</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <div class="agent-input-wrap">
      {#if error}
        <div class="agent-error">{error}</div>
      {/if}
      <textarea
        bind:this={inputEl}
        bind:value={input}
        on:keydown={handleKeydown}
        placeholder="输入问题，Shift+Enter 发送…"
        rows="3"
        disabled={streaming}
      ></textarea>
      <div class="input-footer">
        <span class="input-hint">Shift+Enter 发送 · Enter 换行 · Shift+N 清空</span>
        <div class="input-footer-right">
          {#if $agentMessages.length > 0}
            <button type="button" class="clear-link" on:click={clearChat} disabled={streaming}>
              清空对话
            </button>
          {/if}
          <button type="button" on:click={() => send()} disabled={streaming || !input.trim()}>
            {streaming ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .wrap {
    height: calc(100vh - 48px);
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }
  .input-footer-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .input-footer button.clear-link {
    font-size: 0.75rem;
    color: #888;
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-weight: 400;
    text-decoration: underline;
  }
  .input-footer button.clear-link:hover:not(:disabled) { color: #111; background: transparent; }
  .input-footer button.clear-link:disabled { opacity: 0.4; cursor: not-allowed; }

  .agent-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
    padding-bottom: calc(1.25rem + 50px);
  }
  .agent-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    padding: 2rem;
    text-align: center;
  }
  .agent-empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: #111;
    margin: 0 0 0.35rem;
  }
  .agent-empty-desc {
    font-size: 0.8125rem;
    color: #6b7280;
    margin: 0 0 1.25rem;
  }
  .quick-prompts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
  .quick-prompt {
    padding: 0.5rem 0.875rem;
    font-size: 0.8125rem;
    color: #555;
    background: #f5f5f5;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, border-color 0.15s;
  }
  .quick-prompt:hover:not(:disabled) {
    background: #eee;
    border-color: #d1d5db;
    color: #111;
  }
  .quick-prompt:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .msg {
    margin-bottom: 1.125rem;
  }
  .msg-role {
    font-size: 0.75rem;
    font-weight: 600;
    color: #666;
    display: block;
    margin-bottom: 0.25rem;
  }
  .msg.user .msg-role { color: #0969da; }
  .msg-content {
    font-size: 0.875rem;
    line-height: 1.65;
    word-break: break-word;
    color: #111;
  }
  .msg.user .msg-content {
    white-space: pre-wrap;
  }
  .msg-usage {
    font-size: 0.6875rem;
    color: #9ca3af;
    margin-top: 0.35rem;
  }
  .tool-calls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }
  .tool-call {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    background: #f5f5f5;
    border: 1px solid #e8e8e8;
  }
  .tool-call.running {
    background: #e8f4fd;
    border-color: #b3d9f5;
    color: #0969da;
  }
  .tool-call.success {
    background: #f0f9f0;
    border-color: #c8e6c9;
    color: #2e7d32;
  }
  .tool-call.error {
    background: #fff5f5;
    border-color: #ffcdd2;
    color: #c62828;
  }
  .tool-call-icon { font-size: 0.8em; opacity: 0.9; }
  .tool-call.running .tool-call-icon {
    animation: tool-spin 1s linear infinite;
  }
  @keyframes tool-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .tool-call-name { font-weight: 500; }
  .tool-call-args {
    color: #888;
    font-size: 0.9em;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cursor {
    animation: blink 1s step-end infinite;
    color: #0969da;
  }
  @keyframes blink { 50% { opacity: 0; } }

  :global(.msg-content.markdown-body) { font-size: 0.875rem; line-height: 1.65; color: #111; }
  :global(.msg-content.markdown-body p) { margin: 0 0 0.6em; }
  :global(.msg-content.markdown-body p:last-child) { margin-bottom: 0; }
  :global(.msg-content.markdown-body ul),
  :global(.msg-content.markdown-body ol) { margin: 0.4em 0 0.6em 1.25em; padding: 0; }
  :global(.msg-content.markdown-body li) { margin-bottom: 0.2em; }
  :global(.msg-content.markdown-body h1),
  :global(.msg-content.markdown-body h2),
  :global(.msg-content.markdown-body h3) {
    font-weight: 600;
    margin: 0.75em 0 0.35em;
    line-height: 1.3;
  }
  :global(.msg-content.markdown-body h1) { font-size: 1.05em; }
  :global(.msg-content.markdown-body h2) { font-size: 0.975em; }
  :global(.msg-content.markdown-body h3) { font-size: 0.9em; }
  :global(.msg-content.markdown-body code) {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    font-size: 0.85em;
    background: #f0f0f0;
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  :global(.msg-content.markdown-body pre) {
    background: #f5f5f5;
    border: 1px solid #e8e8e8;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  :global(.msg-content.markdown-body pre code) {
    background: none;
    padding: 0;
    font-size: 0.8125rem;
    border-radius: 0;
  }
  :global(.msg-content.markdown-body blockquote) {
    border-left: 3px solid #ddd;
    margin: 0.5em 0;
    padding: 0.25em 0.75em;
    color: #666;
  }
  :global(.msg-content.markdown-body a) { color: #0969da; text-decoration: none; }
  :global(.msg-content.markdown-body a:hover) { text-decoration: underline; }
  :global(.msg-content.markdown-body hr) { border: none; border-top: 1px solid #e5e7eb; margin: 0.75em 0; }
  :global(.msg-content.markdown-body strong) { font-weight: 600; }
  :global(.msg-content.markdown-body .table-wrap) {
    overflow-x: auto;
    margin: 0.5em 0;
    -webkit-overflow-scrolling: touch;
  }
  :global(.msg-content.markdown-body table) {
    border-collapse: collapse;
    width: 100%;
    min-width: 200px;
    font-size: 0.85em;
  }
  :global(.msg-content.markdown-body thead) { display: table-header-group; }
  :global(.msg-content.markdown-body tbody) { display: table-row-group; }
  :global(.msg-content.markdown-body th),
  :global(.msg-content.markdown-body td) {
    border: 1px solid #e5e7eb;
    padding: 0.35em 0.6em;
    text-align: left;
    word-break: break-word;
    vertical-align: top;
  }
  :global(.msg-content.markdown-body th) { background: #f5f5f5; font-weight: 600; white-space: nowrap; }

  .agent-input-wrap {
    flex-shrink: 0;
    border-top: 1px solid #f0f0f0;
    padding: 0.875rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .agent-error {
    font-size: 0.8rem;
    color: #c62828;
    background: #fff5f5;
    border: 1px solid #ffcdd2;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
  }
  .agent-input-wrap textarea {
    width: 100%;
    resize: none;
    padding: 0.625rem 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 0.875rem;
    font-family: inherit;
    line-height: 1.5;
    color: #111;
    background: #fafafa;
  }
  .agent-input-wrap textarea:focus {
    outline: none;
    border-color: #aaa;
    background: #fff;
  }
  .agent-input-wrap textarea:disabled {
    background: #f5f5f5;
    color: #999;
  }
  .input-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .input-hint {
    font-size: 0.75rem;
    color: #bbb;
  }
  .input-footer button {
    padding: 0.45rem 1.125rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .input-footer button:hover:not(:disabled) { background: #333; }
  .input-footer button:disabled { background: #ccc; cursor: not-allowed; }
</style>
