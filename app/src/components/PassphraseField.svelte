<script>
  /*
    The app's ONE password/passphrase input pattern (FreedomClock lineage):
    in-field show + copy icons, a strength bar, and a "Suggest a passphrase"
    link. Used wherever the plan is protected with a passphrase (Settings →
    Plan protection, add/rekey a slot).
  */
  import { generatePassphrase, estimateBits, strength } from '../lib/passphrase.js';
  import Callout from './Callout.svelte';
  import InfoHint from './InfoHint.svelte';

  let { value = $bindable(''), confirmOk = $bindable(true), placeholder = 'Password or passphrase', onEnter = null, autofocus = false, strengthHint = '' } = $props();

  let show = $state(false);
  let copied = $state(false);
  let copyTimer;

  // A hand-typed password gets a "repeat it" field — these passwords are
  // unrecoverable, and a masked typo would be fatal. A GENERATED passphrase is
  // shown in the clear and copied, so repeating it adds nothing but friction.
  let generated = $state(false);
  let confirm = $state('');
  const needsConfirm = $derived(!!value && !generated);
  const mismatch = $derived(needsConfirm && !!confirm && confirm !== value);
  $effect(() => { confirmOk = !needsConfirm || confirm === value; });

  const bits = $derived(estimateBits(value));
  const str = $derived(strength(bits));
  const barW = $derived(({ weak: 28, ok: 55, strong: 80, vstrong: 100 })[str.tone] || 0);

  function suggest() { value = generatePassphrase(6); generated = true; confirm = ''; show = true; }
  function copyPassword() {
    if (!value || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    }).catch(() => {});
  }
</script>

<div class="pw-block">
  <div class="pw-field">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="inp"
      type={show ? 'text' : 'password'}
      bind:value
      {placeholder}
      {autofocus}
      autocomplete="new-password"
      oninput={() => (generated = false)}
      onkeydown={(e) => e.key === 'Enter' && onEnter?.()}
    />
    <button class="pw-icon pw-eye" type="button" data-tip={show ? 'Hide' : 'Show'} data-tip-pos="top" aria-label={show ? 'Hide password' : 'Show password'} onclick={() => (show = !show)}>
      {#if show}
        <!-- password is visible → crossed-out eye: clicking hides it -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
      {:else}
        <!-- password is hidden → open eye: clicking reveals it -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      {/if}
    </button>
    <button class="pw-icon pw-copy" class:ok={copied} type="button" data-tip="Copy password" data-tip-pos="top" aria-label="Copy password" onclick={copyPassword}>
      {#if copied}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      {/if}
    </button>
  </div>

  <div class="pw-bar"><span class="pw-fill {str.tone}" style="width:{value ? barW : 0}%"></span></div>
  <div class="pw-meta-row">
    <span class="pw-strength {str.tone}">{value ? str.label : ''}</span>
    <span class="pw-gen-wrap">
      <button class="btn-link pw-gen-link" type="button" onclick={suggest}>Suggest a passphrase</button>
      {#if strengthHint}<InfoHint text={strengthHint} label="About passphrase strength" pos="left" />{/if}
    </span>
  </div>

  {#if needsConfirm}
    <input
      class="inp"
      type={show ? 'text' : 'password'}
      bind:value={confirm}
      placeholder="Repeat the password"
      autocomplete="new-password"
      onkeydown={(e) => e.key === 'Enter' && onEnter?.()}
    />
    {#if mismatch}<Callout text="The two passwords don't match yet." />{/if}
  {/if}
</div>

<style>
  .pw-block { display: flex; flex-direction: column; gap: 10px; }
  .inp {
    flex: 1; font: inherit; font-size: 14px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 10px 12px; background: var(--paper);
  }
  .inp:focus { outline: none; border-color: var(--accent-deep); }
  /* Password field with in-field show + copy icons (FreedomClock pattern) */
  .pw-field { position: relative; }
  .pw-field .inp { width: 100%; padding-right: 70px; }
  .pw-icon { position: absolute; top: 50%; transform: translateY(-50%); display: flex; align-items: center; background: none; border: none; cursor: pointer; color: var(--ink-mute); padding: 2px 4px; line-height: 1; }
  .pw-icon:hover { color: var(--ink); }
  .pw-eye { right: 36px; }
  .pw-copy { right: 10px; }
  .pw-copy.ok { color: oklch(0.55 0.14 150); }
  .pw-bar { height: 4px; border-radius: 2px; background: var(--rule); overflow: hidden; }
  .pw-fill { display: block; height: 100%; width: 0; border-radius: 2px; transition: width .3s, background .3s; }
  .pw-fill.weak { background: var(--warn); }
  .pw-fill.ok { background: oklch(0.78 0.13 75); }
  .pw-fill.strong { background: var(--accent-deep); }
  .pw-fill.vstrong { background: oklch(0.62 0.15 150); }
  .pw-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -3px; }
  .pw-strength { font-size: 11px; color: var(--ink-mute); }
  .pw-strength.weak { color: var(--warn); }
  .pw-strength.vstrong { color: oklch(0.55 0.14 150); }
  .pw-gen-wrap { display: inline-flex; align-items: center; }
  .pw-gen-link { font-size: 11px; }
</style>
