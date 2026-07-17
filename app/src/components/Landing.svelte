<script>
  import { loadFromFiles, decryptAndLoad } from '../lib/load.js';
  import logo from '../assets/logo.svg';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import UnlockGate from './UnlockGate.svelte';
  import Callout from './Callout.svelte';

  let { onLoaded, newPlan, drafts = [], resumeDraft, discardDraft } = $props();

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
    const ok = await askModal({ tone: 'danger', title: 'Delete this plan?', message: 'This will permanently delete the plan from this browser. This cannot be undone.', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
    if (ok) discardDraft?.(key);
  }

  // Where-your-plans-live warning: a teaching banner above the plan list.
  // Once dismissed the user knows the deal — never show it again (localStorage,
  // same pattern as the draft explainer in GuideView).
  const STORAGE_NOTE_KEY = 'openfirst.storageNote.dismissed';
  let storageNoteDismissed = $state(false);
  try { storageNoteDismissed = localStorage.getItem(STORAGE_NOTE_KEY) === '1'; } catch { /* private mode */ }
  function dismissStorageNote() {
    storageNoteDismissed = true;
    try { localStorage.setItem(STORAGE_NOTE_KEY, '1'); } catch { /* private mode */ }
  }

  let error = $state('');
  let busy = $state(false);
  let fileInput;

  let pendingEnvelope = $state(null);

  async function run(fn) {
    error = '';
    busy = true;
    try {
      const result = await fn();
      if (result?.__encrypted) {
        pendingEnvelope = result.envelope;
      } else {
        onLoaded(result);
      }
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }

  // newPlan is async (it reads existing drafts to pick a unique name) but
  // takes no result to hand to onLoaded — a plain run() call would forward
  // its undefined resolution there, so it gets its own thin error catch.
  async function handleNewPlan() {
    error = '';
    try {
      await newPlan?.();
    } catch (e) {
      error = e?.message || String(e);
    }
  }

  // UnlockGate calls this and shows a kind error itself when it throws.
  async function unlock(password) {
    const pkg = await decryptAndLoad(pendingEnvelope, password);
    pendingEnvelope = null;
    onLoaded(pkg);
  }

  function cancelUnlock() { pendingEnvelope = null; }
</script>

<div class="page">
  <header class="topbar no-print">
    <div class="container row">
      <a class="brand row" href="/">
        <img class="logo" src={logo} alt="" aria-hidden="true" />
        <span class="brand-name"><b>open</b>first</span>
      </a>
      <span class="spacer"></span>
      <nav class="topnav">
        <a href="/demo/">Demo</a>
        <a href="/guides/">Guides</a>
        <a href="/how-to-use/">How to use</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <p class="eyebrow">Your plans</p>
      <h1>{drafts.length ? 'Welcome back.' : 'Start your plan.'}</h1>
      <p class="lede soft">
        Everything you build is saved in this browser's storage, on this computer — no account, no cloud.
        {#if !drafts.length}Start with the map: the people, the places, the things that matter.{/if}
      </p>

      {#if drafts.length && !storageNoteDismissed}
        <p class="storage-note no-print">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Plans saved here live in this browser's own storage. They don't sync and aren't backed up — clearing this browser's site data removes them. <strong>Your exported file is the durable copy.</strong></span>
          <button class="iconbtn note-x" data-tip="Got it — don't show this again" data-tip-pos="left" aria-label="Dismiss storage note" onclick={dismissStorageNote}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </p>
      {/if}
      {#each drafts as draft (draft.key)}
        <div class="draft card no-print">
          <div class="draft-main">
            <strong>{#if draft.protected}<span class="draft-lock" title="Passphrase-protected in this browser's storage"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>{/if}{draft.title}</strong>
            <span class="small muted">{draftWhen(draft.savedAt) ? `saved ${draftWhen(draft.savedAt)} · ` : ''}kept in this browser{draft.protected ? ' · encrypted' : ''}</span>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn btn-primary" onclick={() => resumeDraft?.(draft.key)}>Resume</button>
            <button class="iconbtn danger" data-tip="Delete plan" aria-label="Delete plan" onclick={() => confirmDelete(draft.key)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </button>
          </div>
        </div>
      {/each}

      <div class="action-grid no-print">
        <div class="action-card">
          <p class="soft small">Start building your plan. Your work autosaves to this browser's storage — there's no server, so there's nowhere to upload it to.</p>
          <button class="btn btn-primary" onclick={handleNewPlan}>Create new plan</button>
        </div>
        <div class="action-card">
          <p class="soft small">Open a <code>.json</code> or <code>.zip</code> backup — or recover an editable plan from a heir <code>start-here.html</code>.</p>
          <button class="btn btn-secondary" onclick={() => fileInput.click()}>Open existing plan</button>
        </div>
      </div>

      {#if error}
        <div class="error-slot"><Callout text={error} /></div>
      {/if}

      <input
        bind:this={fileInput}
        type="file"
        accept=".json,.zip,.html,.htm,application/json,application/zip,text/html"
        hidden
        onchange={(e) => run(() => loadFromFiles(e.target.files))}
      />
    </section>
  </main>

  <footer class="screen no-print">
    <div class="container row wrap">
      <span class="tiny">© 2026 OpenFirst™</span>
      <span class="tiny">Made with ❤ in Switzerland</span>
      <span class="spacer"></span>
      <nav class="row wrap footer-nav">
        <a class="tiny" href="/how-to-use/">How to use</a>
        <a class="tiny" href="/security/">Security</a>
        <a class="tiny" href="https://miroremias.com/blog/bitcoin-inheritance-problem/" target="_blank" rel="noopener">The story</a>
        <a class="tiny" href="https://github.com/mr21free/openfirst.io" target="_blank" rel="noopener">GitHub</a>
        <a class="tiny" href="mailto:info@openfirst.io">Contact</a>
      </nav>
    </div>
  </footer>

  {#if pendingEnvelope}
    <UnlockGate modal hint={pendingEnvelope.hint} onUnlock={unlock} onCancel={cancelUnlock} />
  {/if}
</div>

<ConfirmDialog prompt={modalPrompt} onResolve={resolveModal} />

<style>
  .page { display: flex; flex-direction: column; min-height: 100vh; }
  /* Match the marketing site's calmer content column (1160/40) instead of the
     app's wide 1480/28 — same menu, footer and side margins as the home page. */
  .topbar :global(.container),
  main.container,
  footer :global(.container) {
    max-width: 1160px; padding-left: 40px; padding-right: 40px;
  }
  @media (max-width: 640px) {
    .topbar :global(.container),
    main.container,
    footer :global(.container) { padding-left: var(--gutter-mobile); padding-right: var(--gutter-mobile); }
  }
  .topbar {
    position: sticky; top: 0; z-index: 20;
    background: color-mix(in oklch, var(--paper) 86%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--rule-soft);
  }
  /* Target the topbar's own flex row, not .brand (a nested element that
     reuses the "row" utility class for its own layout) — a bare .row match
     was bleeding the topbar's padding onto the logo too, on phones. */
  .topbar > :global(.container) { height: 60px; }
  .brand { font-family: var(--mono); font-weight: 500; gap: 10px; color: var(--ink); }
  .brand-name b { color: var(--accent-deep); font-weight: 500; }
  .brand:hover { text-decoration: none; }
  .logo { width: 24px; height: 24px; display: block; }
  .topnav { display: flex; align-items: center; gap: 24px; }
  .topnav a { color: var(--ink-soft); font-size: 14px; font-weight: 500; }
  .topnav a:hover { color: var(--ink); text-decoration: none; }
  /* Small screens: nav drops to its own line under the logo (freedomclock-style). */
  @media (max-width: 760px) {
    .topbar > :global(.container) { height: auto; flex-wrap: wrap; row-gap: 2px; padding-top: 13px; padding-bottom: 9px; }
    .brand { flex: 1 0 100%; }
    .topnav { flex: 1 0 100%; gap: 18px; }
  }
  main { flex: 1; width: 100%; }
  .hero { padding: 64px 0 48px; }
  h1 {
    margin-top: 14px; font-size: clamp(30px, 4.2vw, 46px);
    font-weight: 650; letter-spacing: -0.025em; line-height: 1.08; max-width: 24ch;
  }
  .lede { margin-top: 18px; max-width: 58ch; font-size: 16.5px; line-height: 1.7; }
  .error-slot { margin-top: 14px; text-align: left; }

  /* Where-plans-live warning above the list (dismissible, teaches once) */
  .storage-note {
    display: flex; align-items: center; gap: 10px;
    margin: 26px 0 0; padding: 10px 13px;
    border-left: 2px solid var(--warn); border-radius: 0;
    background: var(--warn-wash);
    color: var(--ink-soft); font-size: 13.5px; text-align: left;
  }
  .storage-note svg { flex: none; color: var(--warn); }
  .storage-note .note-x { width: 26px; height: 26px; margin-left: auto; flex: none; color: var(--ink-mute); }
  .storage-note + .draft:first-of-type { margin-top: 14px; }

  /* Draft cards */
  .draft {
    margin-top: 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    justify-content: space-between; border-left: 2px solid var(--accent);
  }
  .draft:first-of-type { margin-top: 28px; }
  .draft-main { display: flex; flex-direction: column; gap: 3px; }

  /* Action cards */
  .action-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px;
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

  footer { padding: 30px 0; }
  .footer-tag { color: var(--accent); font-size: 13px; }
  footer .tiny { color: var(--screen-px); }
  .footer-nav { gap: 16px; }
  .footer-nav a:hover { color: var(--accent); text-decoration: none; }
  .draft-lock { display: inline-flex; margin-right: 7px; color: var(--ink-soft); vertical-align: -1px; }

  .unlock h3 { font-size: 19px; }

  @media (max-width: 760px) {
    .action-grid { grid-template-columns: 1fr; }
    .hero { padding-top: 48px; }
  }
</style>
