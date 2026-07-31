<script>
  import { lockBodyScroll } from '../lib/scrollLock.js';

  let { prompt, onResolve } = $props();

  const cancelable = $derived(prompt?.cancelLabel !== null);

  // Optional checkbox (e.g. "also delete the file on disk"). Resets to its
  // default whenever a new prompt is shown. Callers that don't set
  // `prompt.checkbox` are unaffected — `close()` still resolves a plain
  // boolean for them, exactly as before.
  let checkboxChecked = $state(false);
  $effect(() => { checkboxChecked = prompt?.checkbox?.defaultChecked ?? false; });

  $effect(() => { if (prompt) return lockBodyScroll(); });

  function close(confirmed) {
    onResolve?.(prompt?.checkbox ? { confirmed, checked: checkboxChecked } : confirmed);
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
    {#if prompt.checkbox}
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={checkboxChecked} />
        <span>{prompt.checkbox.label}</span>
      </label>
    {/if}
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
    z-index: calc(var(--z-alert) - 1);
    background: var(--scrim);
  }
  .modal-card {
    position: fixed;
    left: 50%;
    top: 50%;
    z-index: var(--z-alert);
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
  .modal-checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 14px;
    font-size: 14px;
    color: var(--ink);
    cursor: pointer;
  }
  .modal-checkbox input { margin-top: 3px; flex: none; }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
    flex-wrap: wrap;
  }
  .modal-card.danger { border-left-color: var(--warn); }
</style>
