<script>
  import logo from '../assets/logo.svg';
  let { hint = '', onUnlock } = $props();

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
    } catch (e) {
      error = 'That password didn’t work. Check capital letters and spaces — and try the hint above. The file is fine; you can try again.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="gate-page">
  <div class="card gate">
    <div class="brand row"><img class="logo" src={logo} alt="" aria-hidden="true" /><span>Life Plan</span></div>
    <span class="lock-ico" aria-hidden="true">🔒</span>
    <h3>This plan is protected</h3>
    <p class="soft small">Enter the password to open it. It is unlocked here on your device — nothing is sent anywhere.</p>
    {#if hint}<p class="hint small"><span class="muted">Hint:</span> {hint}</p>{/if}
    <div class="pw-row">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="pw" type={show ? 'text' : 'password'} bind:value={password} placeholder="Password"
        autocomplete="off" autofocus onkeydown={(e) => e.key === 'Enter' && unlock()} />
      <button class="pw-toggle" type="button" onclick={() => (show = !show)}>{show ? 'Hide' : 'Show'}</button>
    </div>
    {#if error}<p class="error small">{error}</p>{/if}
    <button class="btn btn-primary" onclick={unlock} disabled={busy || !password}>{busy ? 'Opening…' : 'Unlock'}</button>
  </div>
</div>

<style>
  .gate-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .gate {
    width: min(420px, 94vw); border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.14);
  }
  .brand { font-weight: 500; gap: 10px; margin-bottom: 4px; }
  .logo { width: 24px; height: 24px; }
  .lock-ico { font-size: 22px; }
  .gate h3 { font-size: 19px; }
  .hint { background: var(--accent-wash); border-radius: 8px; padding: 8px 12px; }
  .pw-row { display: flex; gap: 8px; }
  .pw {
    flex: 1; font: inherit; font-size: 15px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 10px; padding: 11px 14px; background: var(--paper);
  }
  .pw:focus { outline: none; border-color: var(--accent-deep); }
  .pw-toggle { font-size: 13px; color: var(--ink-mute); padding: 0 6px; }
  .pw-toggle:hover { color: var(--ink); }
  .error { color: var(--warn); }
</style>
