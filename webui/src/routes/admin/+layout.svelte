<script lang="ts">
  import { onMount } from 'svelte';

  const STORAGE_KEY = 'rssany_admin_token';

  type Status = 'loading' | 'locked' | 'unlocked';
  let status: Status = 'loading';
  let tokenInput = '';
  let error = '';
  let verifying = false;

  async function verify(token: string): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/verify', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function unlock() {
    if (!tokenInput.trim() || verifying) return;
    verifying = true;
    error = '';
    try {
      const ok = await verify(tokenInput.trim());
      if (ok) {
        sessionStorage.setItem(STORAGE_KEY, tokenInput.trim());
        status = 'unlocked';
      } else {
        error = 'Token 无效，请检查服务器启动日志';
      }
    } finally {
      verifying = false;
    }
  }

  onMount(async () => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const ok = await verify(saved);
      status = ok ? 'unlocked' : 'locked';
    } else {
      status = 'locked';
    }
  });
</script>

{#if status === 'loading'}
  <div class="gate-wrap">
    <p class="loading">验证中…</p>
  </div>
{:else if status === 'locked'}
  <div class="gate-wrap">
    <div class="gate-card">
      <div class="gate-icon">🔑</div>
      <h2>Admin</h2>
      <p class="gate-hint">请输入服务器启动时输出的 Token</p>
      <form on:submit|preventDefault={unlock}>
        <input
          type="password"
          bind:value={tokenInput}
          placeholder="粘贴 Token…"
          autocomplete="off"
          spellcheck="false"
        />
        {#if error}
          <p class="gate-error">{error}</p>
        {/if}
        <button type="submit" disabled={verifying || !tokenInput.trim()}>
          {verifying ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  </div>
{:else}
  <slot />
{/if}

<style>
  .gate-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 48px);
  }

  .loading {
    color: #aaa;
    font-size: 0.875rem;
  }

  .gate-card {
    width: 100%;
    max-width: 360px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 2.5rem 2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .gate-icon { font-size: 2rem; margin-bottom: 0.25rem; }

  .gate-card h2 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .gate-hint {
    font-size: 0.8125rem;
    color: #888;
    text-align: center;
    margin-bottom: 0.75rem;
  }

  .gate-card form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .gate-card input {
    width: 100%;
    padding: 0.6rem 0.875rem;
    border: 1px solid #ddd;
    border-radius: 7px;
    font-size: 0.875rem;
    font-family: monospace;
    outline: none;
    transition: border 0.15s;
    background: #fafafa;
  }
  .gate-card input:focus { border-color: #111; background: #fff; }

  .gate-error {
    font-size: 0.775rem;
    color: #e53e3e;
    margin: 0;
  }

  .gate-card button {
    padding: 0.6rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 7px;
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
    transition: background 0.15s;
  }
  .gate-card button:hover:not(:disabled) { background: #333; }
  .gate-card button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
