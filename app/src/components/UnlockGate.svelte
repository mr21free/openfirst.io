<script>
  /*
    The ONE password-entry gate (see DESIGN.md). Two shells, same card:
     • full-page (default) — the heir reader's opening screen, resume of a
       protected draft;
     • `modal` — unlocking an encrypted file from within another screen
       (scrim + centered card, Escape/scrim-click cancels).
    `onUnlock(password)` may throw — that's shown as a kind, retryable error.
  */
  import logo from '../assets/logo.svg';
  let { hint = '', onUnlock, onCancel = null, modal = false } = $props();

  let password = $state('');
  let show = $state(false);
  let busy = $state(false);
  let error = $state('');

  async function unlock() {
    if (!password || busy) return;
    error = '';
    busy = true;
    try {
      await onUnlock(password);
      // Unlocked — drop the password from this component's state right away.
      password = '';
      show = false;
    } catch (e) {
      error = 'That password didn’t work. Check capital letters and spaces — and try the hint above. The file is fine; you can try again.';
    } finally {
      busy = false;
    }
  }
</script>

{#snippet gateCard()}
  <div class="card gate" class:modal-card={modal} role={modal ? 'dialog' : undefined} aria-modal={modal ? 'true' : undefined} aria-label={modal ? 'Enter password' : undefined}>
    {#if !modal}
      <div class="brand row"><img class="logo" src={logo} alt="" aria-hidden="true" /><span>OpenFirst</span></div>
    {/if}
    <span class="lock-ico" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    </span>
    <h3>This plan is protected</h3>
    <p class="soft small">Enter the password to open it. It is unlocked here on your device — nothing is sent anywhere.</p>
    {#if hint}<p class="hint small"><span class="muted">Hint:</span> {hint}</p>{/if}
    <div class="pw-row">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="pw" type={show ? 'text' : 'password'} bind:value={password} placeholder="Password"
        autocomplete="new-password" autofocus onkeydown={(e) => e.key === 'Enter' && unlock()} />
      <button class="pw-toggle" type="button" onclick={() => (show = !show)}>{show ? 'Hide' : 'Show'}</button>
    </div>
    {#if error}<p class="error small">{error}</p>{/if}
    <div class="gate-actions">
      {#if onCancel}<button class="btn btn-ghost" onclick={() => onCancel()}>Cancel</button>{/if}
      <button class="btn btn-primary" onclick={unlock} disabled={busy || !password}>{busy ? 'Opening…' : 'Unlock'}</button>
    </div>
  </div>
{/snippet}

<svelte:window onkeydown={(e) => modal && e.key === 'Escape' && onCancel?.()} />

{#if modal}
  <div class="scrim" role="presentation" onclick={() => onCancel?.()}></div>
  {@render gateCard()}
{:else}
  <div class="gate-page">
    {@render gateCard()}
  </div>
{/if}

<style>
  .gate-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .gate {
    width: min(440px, 94vw); border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.14);
    padding: 30px 32px; /* dialogs get more air than inline cards */
  }
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .gate.modal-card {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal);
  }
  .brand { font-weight: 500; gap: 10px; margin-bottom: 4px; }
  .logo { width: 24px; height: 24px; }
  .lock-ico { display: inline-flex; color: var(--ink-soft); }
  .gate h3 { font-size: 19px; }
  .hint { background: var(--accent-wash); border-radius: 0; padding: 8px 12px; }
  .pw-row { display: flex; gap: 8px; }
  .pw {
    flex: 1; font: inherit; font-size: 15px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 11px 14px; background: var(--paper);
  }
  .pw:focus { outline: none; border-color: var(--accent-deep); }
  .pw-toggle { font-size: 13px; color: var(--ink-mute); padding: 0 6px; }
  .pw-toggle:hover { color: var(--ink); }
  .error { color: var(--warn); }
  .gate-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .gate-actions .btn-primary { flex: 1; }
</style>
