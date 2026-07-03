<script>
  import { loadFromFiles, loadSample, decryptAndLoad } from '../lib/load.js';
  import logo from '../assets/logo.svg';
  import ConfirmDialog from './ConfirmDialog.svelte';

  let { onLoaded, newPlan, drafts = [], resumeDraft, discardDraft, focus = '' } = $props();

  function draftWhen(savedAt) {
    return savedAt ? new Date(savedAt).toLocaleString() : '';
  }

  let modalPrompt = $state(null);
  let modalResolve = null;
  function askModal(options) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      modalPrompt = { eyebrow: 'Confirm', title: 'Are you sure?', message: '', confirmLabel: 'OK', cancelLabel: 'Cancel', tone: 'info', ...options };
    });
  }
  function resolveModal(value) {
    const resolve = modalResolve; modalPrompt = null; modalResolve = null; resolve?.(value);
  }

  async function confirmDelete(key) {
    const ok = await askModal({ tone: 'danger', title: 'Delete this draft?', message: 'This will permanently delete the draft from this device. This cannot be undone.', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
    if (ok) discardDraft?.(key);
  }

  let error = $state('');
  let busy = $state(false);
  let fileInput;

  let pendingEnvelope = $state(null);
  let password = $state('');
  let showPassword = $state(false);
  let unlockError = $state('');

  async function run(fn) {
    error = '';
    busy = true;
    try {
      const result = await fn();
      if (result?.__encrypted) {
        pendingEnvelope = result.envelope;
        password = '';
        unlockError = '';
      } else {
        onLoaded(result);
      }
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function unlock() {
    if (!password) return;
    unlockError = '';
    busy = true;
    try {
      const pkg = await decryptAndLoad(pendingEnvelope, password);
      onLoaded(pkg);
    } catch (e) {
      unlockError = 'That password didn\'t work. Check capital letters and spaces — and try the hint above. The file is fine; you can try again.';
    } finally {
      busy = false;
    }
  }

  function cancelUnlock() {
    pendingEnvelope = null;
    password = '';
    unlockError = '';
  }
</script>

<div class="page">
  <header class="topbar no-print">
    <div class="container row">
      <a class="brand row" href="/">
        <img class="logo" src={logo} alt="" aria-hidden="true" />
        <span>OpenFirst</span>
      </a>
      <span class="spacer"></span>
      <nav class="topnav">
        <a href="/how-to-use/">How to use</a>
        <a href="/security/">Security</a>
        <a href="https://miroremias.com/blog/bitcoin-inheritance-problem/" target="_blank" rel="noopener">The story</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <p class="eyebrow">The builder</p>
      <h1>{focus === 'open' ? 'Open a plan.' : drafts.length ? 'Welcome back.' : 'Start your plan.'}</h1>
      <p class="lede soft">
        Everything you build stays on this device — no account, no cloud.
        {#if !drafts.length}Start with the map: the people, the places, the things that matter.{/if}
      </p>

      {#each drafts as draft (draft.key)}
        <div class="draft card no-print">
          <div class="draft-main">
            <strong>{#if draft.protected}<span class="draft-lock" title="Passphrase-protected on this device"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>{/if}{draft.title}</strong>
            <span class="small muted">{draftWhen(draft.savedAt) ? `saved ${draftWhen(draft.savedAt)} · ` : ''}kept on this device{draft.protected ? ' · encrypted' : ''}</span>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn btn-primary" onclick={() => resumeDraft?.(draft.key)}>Resume</button>
            <button class="btn btn-ghost btn-ghost-danger" onclick={() => confirmDelete(draft.key)}>Delete</button>
          </div>
        </div>
      {/each}

      <div class="action-grid no-print">
        <div class="action-card" style:order={focus === 'open' ? 1 : 0}>
          <p class="soft small">Start building your life package. Everything stays on this device.</p>
          <button class="btn {focus === 'open' ? 'btn-secondary' : 'btn-primary'}" onclick={() => newPlan?.()}>Create new plan</button>
        </div>
        <div class="action-card" style:order={focus === 'open' ? 0 : 1}>
          <p class="soft small">Open a <code>.json</code> or <code>.zip</code> backup — or recover an editable plan from a heir <code>start-here.html</code>.</p>
          <button class="btn {focus === 'open' ? 'btn-primary' : 'btn-secondary'}" onclick={() => fileInput.click()}>Open existing plan</button>
        </div>
        <div class="action-card" style="order: 2">
          <p class="soft small">Explore a sample plan to see how everything works.</p>
          <button class="btn btn-secondary" onclick={() => run(loadSample)}>Demo</button>
        </div>
      </div>

      {#if error}
        <p class="error small">{error}</p>
      {/if}

      <input
        bind:this={fileInput}
        type="file"
        accept=".json,.zip,.html,.htm,application/json,application/zip,text/html"
        hidden
        onchange={(e) => run(() => loadFromFiles(e.target.files))}
      />
    </section>

    <div class="section-sep"></div>

    <section class="reassure">
      <div class="panel-card">
        <h3>Encrypted at rest</h3>
        <p class="soft small">Lock your plan with AES-256-GCM before exporting. Without the password, the file reveals nothing.</p>
      </div>
      <div class="panel-card">
        <h3>Private by design</h3>
        <p class="soft small">This page has no servers and no tracking. The plan never leaves your computer.</p>
      </div>
      <div class="panel-card">
        <h3>Built to last</h3>
        <p class="soft small">The plan is plain, open files. Even without this page, the text inside is readable.</p>
      </div>
    </section>
  </main>

  <footer class="screen no-print">
    <div class="container row wrap">
      <span class="footer-tag">openfirst.io · your plan, in safe hands</span>
      <span class="spacer"></span>
      <nav class="row wrap footer-nav">
        <a class="tiny" href="/how-to-use/">How to use</a>
        <a class="tiny" href="/security/">Security</a>
        <span class="tiny">Open source (AGPL) · MIT format · works offline</span>
      </nav>
    </div>
  </footer>

  {#if pendingEnvelope}
    <div class="scrim" role="presentation" onclick={cancelUnlock}></div>
    <div class="unlock card" role="dialog" aria-modal="true" aria-label="Enter password" tabindex="-1">
      <span class="lock-ico" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      </span>
      <h3>This plan is protected</h3>
      <p class="soft small">Enter the password to open it. The file is decrypted here on your device — the password is never sent anywhere.</p>
      {#if pendingEnvelope.hint}
        <p class="hint small"><span class="muted">Hint:</span> {pendingEnvelope.hint}</p>
      {/if}
      <div class="pw-row">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="pw"
          type={showPassword ? 'text' : 'password'}
          bind:value={password}
          placeholder="Password"
          autocomplete="off"
          autofocus
          onkeydown={(e) => e.key === 'Enter' && unlock()}
        />
        <button class="pw-toggle" type="button" onclick={() => (showPassword = !showPassword)}>
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
      {#if unlockError}<p class="error small">{unlockError}</p>{/if}
      <div class="row" style="gap:10px;margin-top:6px">
        <button class="btn btn-primary" onclick={unlock} disabled={busy || !password}>
          {busy ? 'Opening…' : 'Unlock'}
        </button>
        <button class="btn btn-ghost" onclick={cancelUnlock}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog prompt={modalPrompt} onResolve={resolveModal} />

<style>
  .page { display: flex; flex-direction: column; min-height: 100vh; }
  .topbar {
    position: sticky; top: 0; z-index: 20;
    background: color-mix(in oklch, var(--paper) 86%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--rule-soft);
  }
  .topbar .row { height: 60px; }
  .brand { font-weight: 500; gap: 10px; color: var(--ink); }
  .brand:hover { text-decoration: none; }
  .logo { width: 24px; height: 24px; display: block; }
  .topnav { display: flex; align-items: center; gap: 24px; }
  .topnav a { color: var(--ink-soft); font-size: 14px; }
  .topnav a:hover { color: var(--ink); text-decoration: none; }
  main { flex: 1; width: 100%; }
  .hero { padding: 64px 0 48px; }
  h1 {
    margin-top: 14px; font-size: clamp(30px, 4.2vw, 46px);
    font-weight: 300; letter-spacing: -0.012em; line-height: 1.08; max-width: 24ch;
  }
  .lede { margin-top: 18px; max-width: 58ch; font-size: 16.5px; line-height: 1.7; }
  .error { color: var(--warn); margin-top: 14px; white-space: pre-line; text-align: left; }

  /* Draft cards */
  .draft {
    margin-top: 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    justify-content: space-between; border-left: 2px solid var(--accent);
  }
  .draft:first-of-type { margin-top: 28px; }
  .draft-main { display: flex; flex-direction: column; gap: 3px; }
  .btn-ghost-danger:hover { color: var(--warn); border-color: oklch(0.85 0.06 40); }

  /* Action cards */
  .action-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
    margin-top: 48px;
  }
  .action-card {
    display: flex; flex-direction: column; gap: 16px; text-align: left;
    background: var(--paper); border: 1px solid var(--rule-soft);
    border-top: 2px solid var(--accent);
    border-radius: var(--radius); padding: 22px;
  }
  .action-card .btn { margin-top: auto; align-self: center; }
  .action-card code { background: var(--accent-wash); color: var(--accent-deep); padding: 0 5px; border-radius: 4px; font-size: 0.9em; }
  .btn-secondary {
    background: transparent;
    color: var(--accent-deep);
    border: 1px solid var(--accent);
    transition: background .15s, color .15s, border-color .15s;
  }
  .btn-secondary:hover {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  /* Separator */
  .section-sep { height: 1px; background: var(--rule-soft); margin: 0 0 0; }

  /* Reassure section */
  .reassure {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
    padding: 48px 0 80px;
  }
  .panel-card {
    border-left: 2px solid var(--accent);
    padding: 2px 0 2px 18px;
    background: none;
  }
  .panel-card h3 { margin-bottom: 10px; }

  footer { padding: 30px 0; }
  .footer-tag { color: var(--accent); font-size: 13px; }
  footer .tiny { color: var(--screen-px); }
  .footer-nav { gap: 16px; }
  .footer-nav a:hover { color: var(--accent); text-decoration: none; }
  .draft-lock { display: inline-flex; margin-right: 7px; color: var(--ink-soft); vertical-align: -1px; }

  .scrim { position: fixed; inset: 0; background: oklch(0.2 0.03 255 / 0.32); z-index: 60; }
  .unlock {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 61; width: min(440px, 92vw);
    border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.18);
    padding: 30px 32px; /* dialogs get more air than inline cards */
  }
  .lock-ico { display: inline-flex; color: var(--ink-soft); }
  .unlock h3 { font-size: 19px; }
  .hint { background: var(--accent-wash); border-radius: 0; padding: 8px 12px; }
  .pw-row { display: flex; gap: 8px; }
  .pw {
    flex: 1; font: inherit; font-size: 15px;
    border: 1px solid var(--rule); border-radius: 0; padding: 11px 14px;
    background: var(--paper); color: var(--ink);
  }
  .pw:focus { outline: none; border-color: var(--accent-deep); }
  .pw-toggle { font-size: 13px; color: var(--ink-mute); padding: 0 6px; }
  .pw-toggle:hover { color: var(--ink); }

  @media (max-width: 760px) {
    .action-grid { grid-template-columns: 1fr; }
    .reassure { grid-template-columns: 1fr; }
    .hero { padding-top: 48px; }
  }
</style>
