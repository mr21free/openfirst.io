<script>
  /*
    Edit-mode-only strip across the very top of the screen, shown when the
    plan's attachments would make the one-file reader export unwieldy.

    The self-contained start-here.html embeds every attachment as base64
    (+~33%), and very large single HTML files open slowly or not at all in some
    browsers — so past a threshold we tell the owner and point at the .zip
    package export, which keeps attachments as ordinary files.
  */
  let { store } = $props();

  const WARN_BYTES = 50 * 1024 * 1024;
  const SHELL_BYTES = 1.2 * 1024 * 1024; // app + fonts baked into the export

  // Dismissal is remembered per plan on this device (localStorage) — once the
  // owner has read the advice, don't nag; the Export dialog keeps its own note.
  const dismissKey = $derived(`openfirst.sizebar.dismissed:${store.data?.package?.id || 'current'}`);
  let dismissed = $state(false);
  $effect(() => {
    try { dismissed = localStorage.getItem(dismissKey) === '1'; } catch { dismissed = false; }
  });
  function dismiss() {
    dismissed = true;
    try { localStorage.setItem(dismissKey, '1'); } catch { /* private mode etc. */ }
  }

  const estimatedBytes = $derived.by(() => {
    let bytes = 0;
    for (const a of store.data?.attachments || []) {
      bytes += store.attachmentBlobs.get(a.id)?.size || 0;
    }
    return bytes ? Math.round(bytes * (4 / 3) + SHELL_BYTES) : 0;
  });

  const mb = $derived(Math.round(estimatedBytes / (1024 * 1024)));
  const over = $derived(estimatedBytes > WARN_BYTES);
</script>

{#if over && !dismissed}
  <div class="sizebar no-print" role="status">
    <span class="size-txt">
      <strong>Your one-file reader would be ~{mb}&nbsp;MB.</strong>
      A single start-here.html this big can open slowly (or fail) on some computers.
      Best practice: keep photos/videos small, or export the <em>.zip package</em> instead —
      it stores files normally and stays fast at any size. The heir opens it with the same reader.
    </span>
    <button class="size-x" title="Got it — don't show this again for this plan" aria-label="Dismiss" onclick={dismiss}>✕</button>
  </div>
{/if}

<style>
  .sizebar {
    display: flex; gap: 14px; align-items: flex-start; justify-content: space-between;
    padding: 9px 18px;
    background: oklch(0.93 0.05 75);
    color: oklch(0.35 0.06 60);
    border-bottom: 1px solid oklch(0.82 0.07 70);
    font-size: 13px; line-height: 1.45;
  }
  :global([data-theme='dark']) .sizebar {
    background: oklch(0.32 0.05 70);
    color: oklch(0.9 0.04 80);
    border-bottom-color: oklch(0.45 0.06 70);
  }
  .sizebar strong { margin-right: 6px; }
  .size-x { flex: none; font-size: 13px; color: inherit; opacity: 0.7; background: none; border: none; cursor: pointer; padding: 2px 4px; }
  .size-x:hover { opacity: 1; }
</style>
