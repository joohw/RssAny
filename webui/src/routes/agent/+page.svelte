<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { marked } from 'marked';
  import { Popover } from 'bits-ui';
  import Plus from 'lucide-svelte/icons/plus';
  import History from 'lucide-svelte/icons/history';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import {
    agentMessages,
    agentStream,
    rehydrateAgentMessages,
    createNewSession,
    loadSession,
    deleteSession,
    sessionList,
    currentSessionId,
    currentSession,
  } from '$lib/agentSession';
  import type { ToolCall, TokenUsage } from '$lib/agentSession';

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
    '综述一下近期大模型推理/推理优化方向',
    '找几篇与 RAG 或检索增强相关的文章或讨论',
    '对比 CoT 和 ReAct 在 Agent 任务上的差异与适用场景',
    '搜索「LLM agent」相关的最新进展与论文',
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

  function formatSessionDate(ts: number): string {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} 天前`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  let input = '';
  let historyOpen = false;
  let inputEl: HTMLTextAreaElement | null = null;
  let messagesEl: HTMLDivElement | null = null;

  let scrollIntervalId: ReturnType<typeof setInterval> | null = null;
  let userScrolledUp = false;
  let scrollCleanup: (() => void) | null = null;

  $: streaming = $agentStream.streaming;

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
      if (e.key === 'N' && e.shiftKey && $agentMessages.length > 0 && !$agentStream.streaming) {
        e.preventDefault();
        clearChat();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  async function send(promptText?: string) {
    const prompt = (promptText ?? input.trim()).trim();
    if (!prompt || $agentStream.streaming) return;
    if (!promptText) input = '';
    const history = $agentMessages.map((m) =>
      m.role === "user" ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content, usage: m.usage }
    );
    agentMessages.update((m) => [...m, { role: 'user', content: prompt }]);
    agentStream.startStream();

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
                agentStream.appendContent(data.delta);
              }
              if (lastEvent === 'reasoning_delta' && data.delta !== undefined) {
                agentStream.appendReasoning(data.delta);
              }
              if (lastEvent === 'tool_start' && data.toolName) {
                agentStream.setToolCalls([
                  ...agentStream.get().streamToolCalls,
                  { toolCallId: data.toolCallId ?? '', toolName: data.toolName, args: data.args ?? {}, status: 'running' },
                ]);
              }
              if (lastEvent === 'tool_end' && data.toolCallId) {
                agentStream.setToolCalls(
                  agentStream.get().streamToolCalls.map((t) =>
                    t.toolCallId === data.toolCallId ? { ...t, status: data.isError ? 'error' : 'success' } : t
                  )
                );
              }
              if (lastEvent === 'error' && data.message) {
                agentStream.setError(data.message);
              }
              if (lastEvent === 'done' && data.usage) {
                agentStream.setUsage(data.usage);
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (e) {
      agentStream.setError(e instanceof Error ? e.message : String(e));
    } finally {
      agentStream.finishStream();
    }
  }

  function clearChat() {
    agentMessages.clear();
    agentStream.resetStream();
  }

  function handleNewSession() {
    if ($agentMessages.length === 0) return;
    createNewSession();
    historyOpen = false;
  }

  function handleLoadSession(id: string) {
    loadSession(id);
    historyOpen = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<svelte:head>
  <title>Agent - RssAny</title>
</svelte:head>

<div class="agent-wrap">
  <div class="agent-col">
    <header class="agent-header">
      <div class="agent-header-inner">
        <span class="agent-title">{$currentSession?.title ?? '新对话'}</span>
        <div class="agent-header-actions">
          <Popover.Root bind:open={historyOpen} onOpenChange={(v) => (historyOpen = v)}>
            <Popover.Trigger class="agent-header-btn agent-header-btn-icon" disabled={streaming} title="历史会话">
              <History size={18} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="dropdown-panel agent-history-dropdown" sideOffset={6} align="end">
                <div class="dropdown-title">历史会话</div>
                {#if $sessionList.length === 0}
                  <p class="dropdown-empty">暂无历史会话</p>
                {:else}
                  <ul class="dropdown-list">
                    {#each $sessionList as session (session.id)}
                      <li class="dropdown-item group">
                        <div
                          role="button"
                          tabindex="0"
                          class="dropdown-item-main {session.id === $currentSessionId ? 'is-active' : ''}"
                          on:click={() => handleLoadSession(session.id)}
                          on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleLoadSession(session.id))}
                        >
                          <span class="dropdown-item-title">{session.title}</span>
                          <span class="dropdown-item-date">{formatSessionDate(session.updatedAt)}</span>
                        </div>
                        <span
                          role="button"
                          tabindex="0"
                          class="dropdown-item-delete {$sessionList.length <= 1 ? 'is-hidden' : ''}"
                          title="删除此会话"
                          on:click|stopPropagation={() => $sessionList.length > 1 && deleteSession(session.id)}
                          on:keydown|stopPropagation={(e) => e.key === 'Enter' && $sessionList.length > 1 && (e.preventDefault(), deleteSession(session.id))}
                        >×</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button type="button" class="agent-header-btn agent-header-btn-icon" title="新建会话" disabled={streaming} on:click={handleNewSession}>
            <Plus size={18} />
          </button>
        </div>
      </div>
    </header>
    <div class="agent-messages" bind:this={messagesEl}>
      {#if $agentMessages.length === 0}
        <div class="agent-empty">
          <p class="agent-empty-title">Research Agent</p>
          <p class="agent-empty-desc">
           从本地频道与订阅 feeds 检索与综览，对比观点、持续追踪主题；需要时联网搜索并抓取网页正文。
          </p>
          <div class="quick-prompts">
            {#each QUICK_PROMPTS as prompt}
              <button type="button" class="quick-prompt" on:click={() => send(prompt)} disabled={streaming}>{prompt}</button>
            {/each}
          </div>
        </div>
      {:else}
        {#each $agentMessages as msg, i (i + msg.role + msg.content + (msg.reasoning ?? '') + JSON.stringify(msg.toolCalls ?? []))}
          <div class="msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
            {#if msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0}
              <div class="tool-calls">
                {#each msg.toolCalls as tc (tc.toolCallId + tc.status)}
                  <div class="tool-call" class:running={tc.status === 'running'} class:success={tc.status === 'success'} class:error={tc.status === 'error'}>
                    <span class="tool-call-icon">
                      {#if tc.status === 'running'}
                        <span class="tool-call-spinner" aria-hidden="true"><Loader2 size={14} /></span>
                      {:else if tc.status === 'success'}
                        ✓
                      {:else}
                        ✗
                      {/if}
                    </span>
                    <span class="tool-call-name">{toolLabel(tc.toolName)}</span>
                    {#if formatArgs(tc.args)}<span class="tool-call-args">{formatArgs(tc.args)}</span>{/if}
                  </div>
                {/each}
              </div>
            {/if}
            {#if msg.role === 'assistant'}
              {#if msg.reasoning}
                <details class="agent-reasoning">
                  <summary><span class="agent-reasoning-arrow">▼</span> thinking · thought</summary>
                  <div class="agent-reasoning-content">{msg.reasoning}</div>
                </details>
              {/if}
              <div class="msg-content markdown-body">{@html renderMd(msg.content)}</div>
              {#if msg.usage}<div class="msg-usage">{formatUsage(msg.usage)}</div>{/if}
            {:else}
              <div class="msg-content">{msg.content}</div>
            {/if}
          </div>
        {/each}
        {#if $agentStream.streaming}
          <div class="msg assistant">
            {#if $agentStream.streamToolCalls.length > 0}
              <div class="tool-calls">
                {#each $agentStream.streamToolCalls as tc (tc.toolCallId + tc.status)}
                  <div class="tool-call" class:running={tc.status === 'running'} class:success={tc.status === 'success'} class:error={tc.status === 'error'}>
                    <span class="tool-call-icon">
                      {#if tc.status === 'running'}
                        <span class="tool-call-spinner" aria-hidden="true"><Loader2 size={14} /></span>
                      {:else if tc.status === 'success'}
                        ✓
                      {:else}
                        ✗
                      {/if}
                    </span>
                    <span class="tool-call-name">{toolLabel(tc.toolName)}</span>
                    {#if formatArgs(tc.args)}<span class="tool-call-args">{formatArgs(tc.args)}</span>{/if}
                  </div>
                {/each}
              </div>
            {/if}
            {#if $agentStream.streamReasoning}
              <details class="agent-reasoning" open>
                <summary><span class="agent-reasoning-arrow">▼</span> thinking · thought</summary>
                <div class="agent-reasoning-content">{$agentStream.streamReasoning}<span class="cursor">▌</span></div>
              </details>
            {/if}
            <div class="msg-content markdown-body">{@html renderMd($agentStream.streamContent)}<span class="cursor">▌</span></div>
          </div>
        {/if}
      {/if}
    </div>

    <div class="agent-input-wrap">
      {#if $agentStream.error}
        <div class="agent-error">{$agentStream.error}</div>
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
          <button type="button" class="btn-send" on:click={() => send()} disabled={streaming || !input.trim()}>
            {streaming ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .agent-wrap {
    height: 100vh;
    display: flex;
    overflow: hidden;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .agent-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
    position: relative;
  }
  .agent-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    background: linear-gradient(to bottom, #fff 0%, rgba(255, 255, 255, 0.95) 50%, transparent 100%);
    padding: 0.5rem 1rem 1.5rem;
    pointer-events: none;
  }
  .agent-header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    pointer-events: auto;
  }
  .agent-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .agent-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  /* :global 使样式对 bits-ui Trigger 渲染的 button 生效 */
  :global(.agent-header-actions .agent-header-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 32px;
    min-width: 32px;
    padding: 0.35rem 0.6rem;
    font-size: 0.8125rem;
    color: #374151;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
  }
  :global(.agent-header-actions .agent-header-btn:hover:not(:disabled)) {
    background: #f3f4f6;
    color: var(--color-primary);
  }
  :global(.agent-header-actions .agent-header-btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.agent-header-actions .agent-header-btn-icon) {
    padding: 0.4rem;
    color: #6b7280;
  }
  :global(.agent-header-actions .agent-header-btn-icon:hover:not(:disabled)) {
    color: var(--color-primary);
    background: #eff6ff;
  }
  .agent-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 3.5rem 1.25rem 6rem;
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
  .msg-content {
    font-size: 0.875rem;
    line-height: 1.65;
    word-break: break-word;
    color: #111;
  }
  .msg.user .msg-content {
    white-space: pre-wrap;
  }
  .msg.user {
    background: #f5f5f5;
    margin-left: -0.5rem;
    margin-right: -0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
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
    color: var(--color-primary);
  }
  .tool-call-spinner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .tool-call.running .tool-call-spinner :global(svg) {
    animation: tool-spin 1s linear infinite;
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
  .tool-call-icon {
    font-size: 0.8em;
    opacity: 0.9;
  }
  @keyframes tool-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .tool-call-name {
    font-weight: 500;
  }
  .tool-call-args {
    color: #888;
    font-size: 0.9em;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-reasoning {
    margin-bottom: 0.5rem;
    font-size: 0.8125rem;
    color: #6b7280;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
  }
  .agent-reasoning summary {
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    font-weight: 500;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .agent-reasoning summary::-webkit-details-marker {
    display: none;
  }
  .agent-reasoning-arrow {
    display: inline-block;
    font-size: 0.6em;
    transition: transform 0.2s ease;
  }
  .agent-reasoning:not([open]) .agent-reasoning-arrow {
    transform: rotate(-90deg);
  }
  .agent-reasoning-content {
    padding: 0.5rem 0.75rem;
    max-height: 12rem;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid #f3f4f6;
  }
  .cursor {
    animation: blink 1s step-end infinite;
    color: var(--color-primary);
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .agent-input-wrap {
    flex-shrink: 0;
    border-top: 1px solid #f0f0f0;
    padding: 0.75rem 1.25rem 1rem;
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
    padding: 0.35rem 0;
    border: none;
    border-radius: 0;
    font-size: 0.875rem;
    font-family: inherit;
    line-height: 1.5;
    color: #111;
    background: transparent;
    box-shadow: none;
  }
  .agent-input-wrap textarea:focus {
    outline: none;
    border: none;
    background: transparent;
  }
  .agent-input-wrap textarea:disabled {
    background: transparent;
    color: #999;
    opacity: 1;
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
  .input-footer-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .btn-send {
    padding: 0.45rem 1.125rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-send:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }
  .btn-send:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
  /* dropdown (history) */
  :global(.dropdown-panel) {
    z-index: 50;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
  :global(.agent-history-dropdown) {
    min-width: 14rem;
    max-width: 20rem;
    max-height: min(60vh, 360px);
    overflow-y: auto;
  }
  .dropdown-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-muted-foreground);
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }
  .dropdown-empty {
    font-size: 0.8125rem;
    color: var(--color-muted-foreground-soft);
    padding: 0.75rem;
    margin: 0;
  }
  .dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
  }
  .dropdown-item {
    display: flex;
    align-items: stretch;
  }
  .dropdown-item-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    text-align: left;
    color: var(--color-foreground);
    min-width: 0;
    cursor: pointer;
    border: none;
    background: transparent;
    font-family: inherit;
    border-radius: 0;
  }
  .dropdown-item-main:hover {
    background: var(--color-muted);
  }
  .dropdown-item-main.is-active {
    background: var(--color-primary-light);
    color: var(--color-primary);
  }
  .dropdown-item-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .dropdown-item-date {
    font-size: 0.6875rem;
    color: var(--color-muted-foreground-soft);
  }
  .dropdown-item-main.is-active .dropdown-item-date {
    color: var(--color-primary);
    opacity: 0.9;
  }
  .dropdown-item-delete {
    flex-shrink: 0;
    width: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: var(--color-muted-foreground-soft);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .dropdown-item.group:hover .dropdown-item-delete,
  .dropdown-item-delete:hover,
  .dropdown-item-delete:focus {
    opacity: 1;
  }
  .dropdown-item-delete:hover {
    color: var(--color-destructive);
  }
  .dropdown-item-delete.is-hidden {
    opacity: 0;
    pointer-events: none;
  }
  /* markdown */
  :global(.msg-content.markdown-body) { font-size: 0.875rem; line-height: 1.65; color: #111; }
  :global(.msg-content.markdown-body p) { margin: 0 0 0.6em; }
  :global(.msg-content.markdown-body p:last-child) { margin-bottom: 0; }
  :global(.msg-content.markdown-body ul),
  :global(.msg-content.markdown-body ol) { margin: 0.4em 0 0.6em 1.25em; padding: 0; }
  :global(.msg-content.markdown-body li) { margin-bottom: 0.2em; }
  :global(.msg-content.markdown-body h1),
  :global(.msg-content.markdown-body h2),
  :global(.msg-content.markdown-body h3) { font-weight: 600; margin: 0.75em 0 0.35em; line-height: 1.3; }
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
  :global(.msg-content.markdown-body pre code) { background: none; padding: 0; font-size: 0.8125rem; border-radius: 0; }
  :global(.msg-content.markdown-body blockquote) { border-left: 3px solid #ddd; margin: 0.5em 0; padding: 0.25em 0.75em; color: #666; }
  :global(.msg-content.markdown-body a) { color: var(--color-primary); text-decoration: none; }
  :global(.msg-content.markdown-body a:hover) { text-decoration: underline; }
  :global(.msg-content.markdown-body hr) { border: none; border-top: 1px solid #e5e7eb; margin: 0.75em 0; }
  :global(.msg-content.markdown-body strong) { font-weight: 600; }
  :global(.msg-content.markdown-body .table-wrap) { overflow-x: auto; margin: 0.5em 0; -webkit-overflow-scrolling: touch; }
  :global(.msg-content.markdown-body table) { border-collapse: collapse; width: 100%; min-width: 200px; font-size: 0.85em; }
  :global(.msg-content.markdown-body thead) { display: table-header-group; }
  :global(.msg-content.markdown-body tbody) { display: table-row-group; }
  :global(.msg-content.markdown-body th),
  :global(.msg-content.markdown-body td) { border: 1px solid #e5e7eb; padding: 0.35em 0.6em; text-align: left; word-break: break-word; vertical-align: top; }
  :global(.msg-content.markdown-body th) { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
</style>
