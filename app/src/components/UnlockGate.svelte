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
  import Callout from './Callout.svelte';
  import { lockBodyScroll } from '../lib/scrollLock.js';
  import { APP_DOMAIN } from '../lib/format.js';
  let { hint = '', onUnlock, onCancel = null, modal = false } = $props();

  $effect(() => { if (modal) return lockBodyScroll(); });

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
      error = hint
        ? 'That password didn’t work. Check capital letters and spaces — and try the hint above. The file is fine; you can try again.'
        : 'That password didn’t work. Check capital letters and spaces. The file is fine; you can try again.';
    } finally {
      busy = false;
    }
  }
</script>

{#snippet gateCard()}
  <div class="card gate" class:modal-card={modal} role={modal ? 'dialog' : undefined} aria-modal={modal ? 'true' : undefined} aria-label={modal ? 'Enter password' : undefined}>
    {#if !modal}
      <a class="brand row" href={`https://${APP_DOMAIN}/`} target="_blank" rel="noopener"><img class="logo" src={logo} alt="" aria-hidden="true" /><span class="brand-name"><b>open</b>first.io</span></a>
    {/if}
    <div class="gate-title row">
      <span class="lock-ico" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      </span>
      <h3>This plan is protected</h3>
    </div>
    <p class="soft small">Enter the password to open it.</p>
    {#if hint}<p class="soft small"><strong>Hint:</strong> {hint}</p>{/if}
    <div class="pw-field">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="pw inp" type={show ? 'text' : 'password'} bind:value={password} placeholder="Password"
        autocomplete="new-password" autofocus onkeydown={(e) => e.key === 'Enter' && unlock()} />
      <button class="pw-icon" type="button" data-tip={show ? 'Hide' : 'Show'} data-tip-pos="top" aria-label={show ? 'Hide password' : 'Show password'} onclick={() => (show = !show)}>
        {#if show}
          <!-- password is visible → crossed-out eye: clicking hides it -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
        {:else}
          <!-- password is hidden → open eye: clicking reveals it -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
        {/if}
      </button>
    </div>
    {#if error}<Callout text={error} />{/if}
    <div class="gate-actions">
      <button class="btn btn-primary" onclick={unlock} disabled={busy || !password}>{busy ? 'Opening…' : 'Unlock'}</button>
      {#if onCancel}<button class="btn btn-ghost" onclick={() => onCancel()}>Cancel</button>{/if}
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
    /* .gate-page below already insets 24px on each side, so a raw vw cap here
       double-counts that margin on narrow viewports and pushes the card past
       the right edge; subtracting the same 24px*2 keeps both this full-page
       shell and the raw-viewport .modal-card variant symmetric. */
    width: min(440px, calc(100vw - 48px)); border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.14);
    padding: 30px 32px; /* dialogs get more air than inline cards */
  }
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .gate.modal-card {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal);
  }
  .brand { font-family: var(--mono); font-weight: 500; gap: 10px; margin-bottom: 4px; color: var(--ink); }
  .brand:hover { text-decoration: none; }
  .brand-name b { color: var(--accent-deep); font-weight: 500; }
  .logo { width: 24px; height: 24px; }
  .gate-title { gap: 10px; }
  .lock-ico { display: inline-flex; color: var(--ink-soft); }
  .gate h3 { font-size: 19px; margin: 0; }
  .pw-field { position: relative; }
  .inp {
    width: 100%; font: inherit; font-size: 14px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 10px 40px 10px 12px; background: var(--paper);
  }
  .inp:focus { outline: none; border-color: var(--accent-deep); }
  .pw-icon {
    position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
    display: flex; align-items: center; background: none; border: none; cursor: pointer;
    color: var(--ink-mute); padding: 2px 4px; line-height: 1;
  }
  .pw-icon:hover { color: var(--ink); }
  .gate-actions { display: flex; gap: 8px; justify-content: flex-start; }
</style>
