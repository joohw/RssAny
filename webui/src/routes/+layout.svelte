<script lang="ts">
  // 全局布局：挂载 Topbar + Toast，注入全局 CSS 变量与重置样式
  import Topbar from '$lib/Topbar.svelte';
  import Toast from '$lib/Toast.svelte';
</script>

<Topbar />
<slot />
<Toast />

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0 }
  :global(body) { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #111; min-height: 100vh }

  /* ── 按钮 ── */
  :global(.btn) { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.5rem 1rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-family: inherit; transition: background 0.15s; text-decoration: none; flex-shrink: 0 }
  :global(.btn-primary) { background: #111; color: #fff }
  :global(.btn-primary:hover) { background: #333 }
  :global(.btn-secondary) { background: #f0f0f0; color: #333 }
  :global(.btn-secondary:hover) { background: #e0e0e0 }
  :global(.btn-danger) { background: #fff0f0; color: #c0392b; border: 1px solid #fcc }
  :global(.btn-danger:hover) { background: #ffe0e0 }
  :global(.btn-sm) { padding: 0.3rem 0.65rem; font-size: 0.8rem }
  :global(.btn:disabled) { opacity: 0.5; cursor: not-allowed }

  /* ── Badge ── */
  :global(.badge) { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 500 }
  :global(.badge-cache) { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0 }
  :global(.badge-live) { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa }
  :global(.badge-extracting) { background: #fefce8; color: #854d0e; border: 1px solid #fef08a }
  :global(.badge-error) { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca }
  :global(.badge-auth) { background: #fff7e0; color: #92640a; border: 1px solid #f0d080 }
  :global(.badge-parser) { background: #e8f4fd; color: #0969da; border: 1px solid #b8dcf8 }
  :global(.badge-extractor) { background: #e6f9ee; color: #1a7f37; border: 1px solid #a8e6be }
  :global(.badge-interval) { background: #f0f0f0; color: #555; border: 1px solid #ddd }

  /* ── 表单 ── */
  :global(.form-group) { margin-bottom: 1.125rem }
  :global(.form-label) { display: block; font-size: 0.8125rem; font-weight: 500; color: #444; margin-bottom: 0.4rem }
  :global(.form-hint) { font-size: 0.75rem; color: #aaa; margin-top: 0.3rem; line-height: 1.5 }
  :global(.form-input) { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; font-family: inherit; outline: none; transition: border 0.15s }
  :global(.form-input:focus) { border-color: #111 }
  :global(.form-input:disabled) { background: #f8f8f8; color: #aaa }
  :global(select.form-input) { font-family: inherit }
  :global(textarea.form-input) { resize: vertical; min-height: 120px; font-family: monospace; font-size: 0.8125rem }
  :global(.form-row) { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem }

  /* ── Modal ── */
  :global(.overlay) { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; display: none; align-items: flex-start; justify-content: center; padding-top: 6vh; overflow-y: auto }
  :global(.overlay.open) { display: flex }
  :global(.modal) { background: #fff; border-radius: 12px; width: 100%; max-width: 560px; padding: 1.75rem; margin: 1rem; box-shadow: 0 20px 60px rgba(0,0,0,0.15) }
  :global(.modal-header) { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem }
  :global(.modal-title) { font-size: 1.0625rem; font-weight: 600 }
  :global(.modal-close) { background: none; border: none; font-size: 1.25rem; cursor: pointer; color: #888; padding: 0.25rem; line-height: 1 }
  :global(.modal-close:hover) { color: #111 }
  :global(.modal-footer) { display: flex; justify-content: flex-end; gap: 0.625rem; margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid #f0f0f0 }

  /* ── 表格 ── */
  :global(.table-wrap) { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 1rem }
  :global(table) { width: 100%; border-collapse: collapse }
  :global(thead th) { background: #fafafa; font-size: 0.75rem; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 1rem; text-align: left; border-bottom: 1px solid #f0f0f0 }
  :global(tbody tr) { border-bottom: 1px solid #f5f5f5; transition: background 0.1s }
  :global(tbody tr:last-child) { border-bottom: none }
  :global(tbody tr:hover) { background: #fafafa }
  :global(td) { padding: 0.75rem 1rem; font-size: 0.875rem; vertical-align: middle }

  /* ── Info box ── */
  :global(.info-box) { background: #f8f9ff; border: 1px solid #dde4ff; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.75rem; font-size: 0.8125rem; color: #555; line-height: 1.7 }
  :global(.info-box strong) { color: #111 }
  :global(.info-box code) { background: #eef; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.8rem; font-family: monospace }
  :global(.info-box ul) { padding-left: 1.2rem; margin-top: 0.4rem }
  :global(.info-box li) { margin-bottom: 0.2rem }

  /* ── 状态 ── */
  :global(.empty-row td) { text-align: center; color: #bbb; padding: 3rem; font-size: 0.875rem }
  :global(.loading-row td) { text-align: center; color: #bbb; padding: 2rem; font-size: 0.875rem }
  :global(.loading-state) { text-align: center; padding: 3rem; color: #aaa; font-size: 0.9rem }
  :global(.empty-state) { text-align: center; padding: 4rem 2rem; color: #aaa }
  :global(.empty-state p) { font-size: 0.9375rem; margin-bottom: 1rem }

  /* ── 容器 ── */
  :global(.container) { max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem }
  :global(.page-header) { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.75rem; gap: 1rem }
  :global(.page-header h1) { font-size: 1.25rem; font-weight: 700 }

  @media (max-width: 500px) {
    :global(.form-row) { grid-template-columns: 1fr }
    :global(.modal) { margin: 0.5rem }
  }
</style>
