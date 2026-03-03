<script lang="ts">
  interface ToolCall {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
  }

  interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCall[];
  }

  const TOOL_LABELS: Record<string, string> = {
    list_channels: '列出频道',
    get_channel_feeds: '获取 feeds',
    get_feed_detail: '获取详情',
    search_feeds: '搜索',
  };

  function toolLabel(name: string): string {
    return TOOL_LABELS[name] ?? name;
  }

  function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  }

  let input = '';
  let messages: ChatMessage[] = [];
  let streaming = false;
  let streamContent = '';
  let streamToolCalls: ToolCall[] = [];
  let error = '';

  async function send() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    input = '';
    messages = [...messages, { role: 'user', content: prompt }];
    streaming = true;
    streamContent = '';
    streamToolCalls = [];
    error = '';

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
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
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: error || streamContent || '(无回复)',
          toolCalls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
        },
      ];
    }
    streamContent = '';
    streamToolCalls = [];
  }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<svelte:head>
  <title>Chat - RssAny</title>
</svelte:head>

<div class="chat-wrap">
  <div class="chat-main">
    <div class="chat-messages">
      {#if messages.length === 0}
        <div class="chat-empty">
          <p>向 RSS 助手提问，例如：</p>
          <ul>
            <li>有哪些频道？</li>
            <li>科技频道最新 5 条</li>
            <li>搜索「AI」相关文章</li>
          </ul>
        </div>
      {:else}
        {#each messages as msg, i (i + msg.role + msg.content + JSON.stringify(msg.toolCalls ?? []))}
          <div class="msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
            <span class="msg-role">{msg.role === 'user' ? '你' : '助手'}</span>
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
            <div class="msg-content">{msg.content}</div>
          </div>
        {/each}
        {#if streaming}
          <div class="msg assistant">
            <span class="msg-role">助手</span>
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
            <div class="msg-content">
              {streamContent}
              <span class="cursor">▌</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>
    <div class="chat-input-wrap">
      <textarea
        bind:value={input}
        on:keydown={handleKeydown}
        placeholder="输入问题，按 Enter 发送…"
        rows="2"
        disabled={streaming}
      ></textarea>
      <button type="button" on:click={send} disabled={streaming || !input.trim()}>
        {streaming ? '发送中…' : '发送'}
      </button>
    </div>
    {#if error}
      <div class="chat-error">{error}</div>
    {/if}
  </div>
</div>

<style>
  .chat-wrap {
    height: calc(100vh - 48px);
    display: flex;
    justify-content: center;
    padding: 1rem;
  }
  .chat-main {
    width: 100%;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    overflow: hidden;
  }
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
  }
  .chat-empty {
    color: #888;
    font-size: 0.9rem;
    line-height: 1.7;
  }
  .chat-empty p { margin-bottom: 0.5rem; }
  .chat-empty ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  .msg {
    margin-bottom: 1rem;
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
    font-size: 0.9rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
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
  .tool-call-icon {
    font-size: 0.8em;
    opacity: 0.9;
  }
  .tool-call.running .tool-call-icon {
    animation: tool-spin 1s linear infinite;
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
  .cursor {
    animation: blink 1s step-end infinite;
    color: #0969da;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .chat-input-wrap {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid #eee;
  }
  .chat-input-wrap textarea {
    flex: 1;
    resize: none;
    padding: 0.6rem 0.75rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .chat-input-wrap textarea:focus {
    outline: none;
    border-color: #0969da;
  }
  .chat-input-wrap textarea:disabled {
    background: #f9f9f9;
    color: #999;
  }
  .chat-input-wrap button {
    padding: 0.6rem 1.25rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    align-self: flex-end;
  }
  .chat-input-wrap button:hover:not(:disabled) {
    background: #333;
  }
  .chat-input-wrap button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
  .chat-error {
    padding: 0.5rem 1.25rem;
    font-size: 0.8rem;
    color: #c00;
    background: #fff5f5;
  }
</style>
