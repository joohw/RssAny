<script lang="ts">
  import { toast } from '$lib/toastStore.js';
</script>

{#if $toast.msg}
  <div class="toast {$toast.type}">{$toast.msg}</div>
{/if}

<style>
  .toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #111;
    color: #fff;
    padding: 0.625rem 1.25rem;
    border-radius: 8px;
    font-size: 0.875rem;
    z-index: 100;
    white-space: nowrap;
    pointer-events: none;
  }
  .toast.error {
    background: #c0392b;
  }
  .toast.success {
    background: #1a7f37;
  }
</style>
