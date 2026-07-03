<script>
  let { prompt, onResolve } = $props();

  const cancelable = $derived(prompt?.cancelLabel !== null);

  function close(value) {
    onResolve?.(value);
  }

  function onKeydown(e) {
    if (prompt && e.key === 'Escape' && cancelable) close(false);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if prompt}
  <div class="modal-scrim" onclick={() => cancelable && close(false)} role="presentation"></div>
  <div class="modal-card" class:danger={prompt.tone === 'danger'} role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">
    <div class="modal-head">
      <span class="eyebrow">{prompt.eyebrow || 'Confirm'}</span>
      <h2 id="modal-title">{prompt.title}</h2>
    </div>
    <p id="modal-message" class="modal-message">{prompt.message}</p>
    <div class="modal-actions">
      {#if cancelable}
        <button class="btn btn-ghost" onclick={() => close(false)}>{prompt.cancelLabel || 'Cancel'}</button>
      {/if}
      <button class="btn" class:btn-primary={prompt.tone !== 'danger'} class:btn-danger={prompt.tone === 'danger'} onclick={() => close(true)}>
        {prompt.confirmLabel || 'OK'}
      </button>
    </div>
  </div>
{/if}

<style>
  .modal-scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: oklch(0.2 0.03 255 / 0.42);
  }
  .modal-card {
    position: fixed;
    left: 50%;
    top: 50%;
    z-index: 101;
    width: min(460px, calc(100vw - 32px));
    transform: translate(-50%, -50%);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-left: 2px solid var(--accent);
    border-radius: 0; /* dialogs share the app's sharp paper edges */
    box-shadow: 0 30px 80px oklch(0.2 0.03 255 / 0.26);
    padding: 30px 32px;
  }
  .modal-head h2 {
    margin-top: 6px;
    font-size: 22px;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .modal-message {
    margin-top: 14px;
    color: var(--ink-soft);
    font-size: 14px;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
    flex-wrap: wrap;
  }
  .modal-card.danger { border-left-color: var(--warn); }
</style>
