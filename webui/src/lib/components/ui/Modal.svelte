<script lang="ts">
  export let title = '';
  export let onClose: (() => void) | undefined = undefined;

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && onClose) onClose();
  }
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  on:click={handleBackdropClick}
>
  <div class="modal-dialog" on:click|stopPropagation>
    <div class="modal-header">
      <h3 id="modal-title">{title}</h3>
      <button type="button" class="modal-close" on:click={() => onClose?.()} aria-label="关闭">×</button>
    </div>
    <div class="modal-body">
      <slot />
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    padding: 1rem;
  }
  .modal-dialog {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    max-width: 420px;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .modal-header h3 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
  }
  .modal-close {
    font-size: 1.25rem;
    line-height: 1;
    padding: 0.2rem;
    color: #6b7280;
    background: none;
    border: none;
    cursor: pointer;
  }
  .modal-close:hover {
    color: #111;
  }
  .modal-body {
    padding: 1rem 1.25rem;
  }
</style>
