<script>
  let { status = '', size = 15, wrapped = false } = $props();
  const normalized = $derived(status || 'not_sure');
</script>

<span class="status-ico" class:wrapped class:pass={normalized === 'pass'} class:fail={normalized === 'fail'} class:blocked={normalized === 'blocked'} class:notSure={normalized === 'not_sure' || !normalized} aria-hidden="true" style={`--si-size:${size}px`}>
  {#if normalized === 'pass'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  {:else if normalized === 'fail'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
  {:else if normalized === 'blocked'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14" /><circle cx="12" cy="12" r="9" /></svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 9a2.8 2.8 0 1 1 5.1 1.6c-.9 1.2-2.4 1.5-2.6 3.4" /><path d="M12 18h.01" /></svg>
  {/if}
</span>

<style>
  .status-ico {
    --si-size: 15px;
    width: var(--si-size);
    height: var(--si-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--ink-mute);
  }
  .status-ico.wrapped {
    width: 30px;
    height: 30px;
    background: var(--accent-wash);
  }
  .status-ico.wrapped svg {
    width: var(--si-size);
    height: var(--si-size);
  }
  .status-ico svg { width: 100%; height: 100%; display: block; }
  .status-ico.pass,
  .status-ico.fail,
  .status-ico.blocked,
  .status-ico.notSure { color: var(--ink-mute); }
</style>
