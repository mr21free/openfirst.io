<script>
  /*
    The ONE way a message reaches someone in this app: a quiet bordered
    callout, not a loud alarm — same left-accent-bar shape wherever a form,
    unlock screen, or dry-run panel needs to say something failed (`error`)
    or flag something to keep in mind (`warning`).
  */
  let { text = '', tone = 'error' } = $props();
</script>

{#if text}
  <div class="error-callout" class:warn-tone={tone === 'warning'} class:success-tone={tone === 'success'} role={tone === 'error' ? 'alert' : 'note'}>
    {#if tone === 'warning'}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    {:else if tone === 'success'}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="8 12.5 10.7 15 16 9" /></svg>
    {:else}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12.01" y2="16.5" /></svg>
    {/if}
    <p>{text}</p>
  </div>
{/if}

<style>
  .error-callout {
    display: flex; gap: 10px; align-items: flex-start;
    border: 1px solid var(--rule-soft); border-left: 2px solid var(--warn);
    background: color-mix(in oklch, var(--warn-wash) 35%, var(--paper));
    padding: 10px 13px;
  }
  .error-callout svg { flex: none; color: var(--warn); margin-top: 2px; }
  .error-callout p { margin: 0; font-size: 13px; color: var(--ink-soft); white-space: pre-line; }

  /* Caution, not failure — same recipe as Landing's storage-note: the warn
     wash at full strength (not diluted into --paper) reads amber, not red. */
  .error-callout.warn-tone { background: var(--warn-wash); }

  /* Confirmation, not failure — a done-checkmark in --good, same shape. */
  .error-callout.success-tone {
    border-left-color: var(--good);
    background: color-mix(in oklch, var(--good-wash) 35%, var(--paper));
  }
  .error-callout.success-tone svg { color: var(--good); }
</style>
