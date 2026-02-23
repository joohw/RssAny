<script lang="ts">
  // Toast 通知浮层组件，挂在 layout 中全局复用
  import { toastStore } from '$lib/toast.js';
</script>

{#if $toastStore.show}
  <div class="toast {$toastStore.type}">{$toastStore.message}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: #111;
    color: #fff;
    padding: 0.625rem 1.25rem;
    border-radius: 8px;
    font-size: 0.875rem;
    z-index: 200;
    white-space: nowrap;
    pointer-events: none;
    animation: fadeIn 0.15s ease;
  }
  .toast.error { background: #c0392b }
  .toast.success { background: #1a7f37 }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(6px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
</style>
