<script>
  import { loadFromFiles, decryptAndLoad } from '../lib/load.js';
  import { APP_DOMAIN } from '../lib/format.js';
  import { APP_VERSION } from '../lib/version.js';
  import logo from '../assets/logo.svg';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import UnlockGate from './UnlockGate.svelte';
  import Callout from './Callout.svelte';

  let {
    onLoaded, newPlan, drafts = [], resumeDraft, discardDraft,
    recentPlans = [], continueRecent, locateRecent, openPickedHtmlHandle, importHtmlOneTime, restoreRecentFromBackup, deleteRecent
  } = $props();

  // A picked .html only reconnects live (keeps autosaving into that same
  // file) on browsers with File System Access — Chrome/Edge. Elsewhere the
  // plain <input type=file> fallback can still read the file, it just can't
  // hold onto a handle, so it becomes a one-time import instead (see
  // handleAnyFileInput / importHtmlOneTime).
  const fsaSupported = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

  // These marketing pages only exist as real routes on the hosted site — a
  // downloaded standalone copy of the app (see scripts/postbuild.mjs's
  // /download/openfirst.html) opened via file:// has no /demo/, /guides/,
  // /how-to-use/, or /security/ next to it, so the relative links would just
  // 404. GitHub and the mailto link are absolute, so they're unaffected and
  // always shown (same convention as App.svelte's onHttp).
  const onHttp = typeof location !== 'undefined' && location.protocol !== 'file:';

  function draftWhen(savedAt) {
    return savedAt
      ? new Date(savedAt).toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        })
      : '';
  }

  // Per-row error state (iteration 2b) — keyed by planId. 'missing' when
  // continueRecent/locateRecent resolves to false (permission denied, parse
  // failure, or the file moved/was deleted); 'mismatch' when locateRecent
  // resolves to the 'mismatch' sentinel (the picked file is a real, valid
  // plan file, just a different plan than this row).
  let recentRowErrors = $state({});

  async function handleContinueRecent(rec) {
    const ok = await continueRecent?.(rec);
    if (ok === false) recentRowErrors = { ...recentRowErrors, [rec.planId]: 'missing' };
  }
  async function handleLocateRecent(rec) {
    const result = await locateRecent?.(rec.planId);
    if (result === 'mismatch') recentRowErrors = { ...recentRowErrors, [rec.planId]: 'mismatch' };
    // `false` (cancelled the picker, or still can't find/read it) leaves the
    // existing error row up as-is.
  }
  async function handleRestoreRecentFromBackup(rec) {
    await restoreRecentFromBackup?.(rec.planId);
  }
  // A recent (file-backed) plan's Delete offers to also remove the file
  // itself — only possible when there's a live handle with grantable
  // read/write permission (a fallback-downloaded plan has no live handle at
  // all; nothing here can reach that file). Defaults to unchecked: deleting
  // the one durable copy of someone's plan by not noticing a pre-checked box
  // is a much worse failure than one extra click.
  async function confirmDeleteRecent(rec) {
    const canDeleteFile = !!rec.handle;
    const result = await askModal({
      tone: 'danger', title: 'Delete this plan?',
      message: `This will permanently delete "${rec.title}" from this browser.`
        + (canDeleteFile ? '' : ` (This plan was saved via a browser download, so its file isn't something this browser can reach to delete — only its copy here will be removed.)`),
      confirmLabel: 'Delete', cancelLabel: 'Cancel',
      checkbox: canDeleteFile ? { label: `Delete the "${rec.name}" file`, defaultChecked: false } : null
    });
    const confirmed = result?.confirmed ?? result;
    if (!confirmed) return;
    const wantedFileDelete = canDeleteFile && !!result.checked;
    const fileDeleteError = await deleteRecent?.(rec.planId, wantedFileDelete);
    if (wantedFileDelete && fileDeleteError) {
      await askModal({
        tone: 'danger', title: "Couldn't delete the file",
        message: `"${rec.title}" was removed from this browser, but the file itself (${rec.name}) could not be deleted: ${fileDeleteError}`,
        confirmLabel: 'OK', cancelLabel: null
      });
    }
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
    const ok = await askModal({ tone: 'danger', title: 'Delete this plan?', message: 'This will permanently delete the plan from this browser.', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
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

  // One "Open existing plan" button for all three formats. On File System
  // Access browsers, a single combined-type picker covers .html/.json/.zip so
  // a picked .html can still reconnect live (see openPickedHtmlHandle);
  // elsewhere the plain <input type=file> fallback below covers the same
  // three extensions, just without a live handle for .html.
  async function handleOpenExisting() {
    if (!fsaSupported) { fileInput.click(); return; }
    error = '';
    busy = true;
    try {
      let handle;
      try {
        handle = (await window.showOpenFilePicker({
          types: [{ description: 'OpenFirst plan or backup', accept: {
            'text/html': ['.html'],
            'application/json': ['.json'],
            'application/zip': ['.zip']
          } }]
        }))[0];
      } catch {
        return; // cancelled the picker
      }
      if (/\.html?$/i.test(handle.name)) {
        const ok = await openPickedHtmlHandle?.(handle);
        if (ok === false) error = "Couldn't open that file — make sure it's a plan .html this app created.";
        // A passphrase-protected file or a successful open both navigate away
        // from Landing entirely (fileGate / the editor) — nothing else to do here.
        return;
      }
      const file = await handle.getFile();
      await run(() => loadFromFiles([file]));
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function handleAnyFileInput(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    if (/\.html?$/i.test(file.name)) {
      error = '';
      busy = true;
      try {
        const ok = await importHtmlOneTime?.(file);
        if (ok === false) error = "Couldn't open that file — make sure it's a plan .html this app created.";
      } catch (e) {
        error = e?.message || String(e);
      } finally {
        busy = false;
      }
      return;
    }
    run(() => loadFromFiles(fileList));
  }
</script>

<div class="page">
  <header class="topbar no-print">
    <div class="container row">
      <a class="brand row" href={`https://${APP_DOMAIN}/`} target="_blank" rel="noopener">
        <img class="logo" src={logo} alt="" aria-hidden="true" />
        <span class="brand-name"><b>open</b>first</span>
      </a>
      <span class="spacer"></span>
      {#if onHttp}
        <nav class="topnav">
          <span class="nav-links">
            <a href="/demo/">Demo</a>
            <a href="/guides/">Guides</a>
            <a href="/how-to-use/">How to use</a>
          </span>
          <span class="nav-cta">
            <a class="btn" href="/download/openfirst.html" download={`openfirst-${APP_VERSION}.html`}>Download</a>
          </span>
        </nav>
      {/if}
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <p class="eyebrow">Your plans</p>
      <h1>{drafts.length || recentPlans.length ? 'Welcome back.' : 'Start your plan.'}</h1>
      <p class="lede soft">
        Everything you build stays on this computer — no account, no cloud.
        {#if !drafts.length && !recentPlans.length}Start with the map: the people, the places, the things that matter.{/if}
      </p>

      <div class="launcher-actions no-print">
        <button
          class="btn btn-primary"
          data-tip="Start building your plan. Your work autosaves to this browser's storage — there's no server, so there's nowhere to upload it to."
          onclick={handleNewPlan}
        >Create new plan</button>
        <button
          class="btn btn-secondary"
          data-tip="Open a plan .html file (reconnects live) or a .json/.zip backup."
          disabled={busy}
          onclick={handleOpenExisting}
        >Open existing plan</button>
      </div>

      {#if (drafts.length || recentPlans.length) && !storageNoteDismissed}
        <p class="storage-note no-print">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Plans saved here live in this browser's own storage. They don't sync and aren't backed up — clearing this browser's site data removes them. <strong>Your exported file is the durable copy.</strong></span>
          <button class="iconbtn note-x" data-tip="Got it — don't show this again" data-tip-pos="left" aria-label="Dismiss storage note" onclick={dismissStorageNote}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </p>
      {/if}
      {#each recentPlans as rec (rec.planId)}
        <div class="draft card no-print">
          {#if recentRowErrors[rec.planId] === 'mismatch'}
            <div class="draft-main">
              <strong>That's a different plan.</strong>
              <span class="small muted">The file you picked isn't {rec.name} — try again, or restore from this browser's backup instead.</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-secondary" onclick={() => handleLocateRecent(rec)}>Try again</button>
              <button class="btn btn-ghost" onclick={() => handleRestoreRecentFromBackup(rec)}>Restore from backup</button>
            </div>
          {:else if recentRowErrors[rec.planId]}
            <div class="draft-main">
              <strong>Can't find {rec.name}.</strong>
              <span class="small muted">It may have been moved, renamed, or deleted.</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-secondary" onclick={() => handleLocateRecent(rec)}>Locate it</button>
              <button class="btn btn-ghost" onclick={() => handleRestoreRecentFromBackup(rec)}>Restore from backup</button>
            </div>
          {:else}
            <div class="draft-main">
              <strong>{#if rec.protected}<span class="draft-lock" title="Passphrase-protected"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>{/if}{rec.title}</strong>
              <span class="small muted">Updated {draftWhen(rec.lastOpenedAt)} · {rec.name}</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-primary" onclick={() => handleContinueRecent(rec)}>Resume</button>
              <button class="iconbtn danger" data-tip="Delete plan" data-tip-pos="left" aria-label="Delete plan" onclick={() => confirmDeleteRecent(rec)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
              </button>
            </div>
          {/if}
        </div>
      {/each}
      {#each drafts as draft (draft.key)}
        <div class="draft card no-print">
          <div class="draft-main">
            <strong>{#if draft.protected}<span class="draft-lock" title="Passphrase-protected in this browser's storage"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>{/if}{draft.title}</strong>
            <span class="small muted">{draftWhen(draft.savedAt) ? `Updated ${draftWhen(draft.savedAt)} · ` : ''}Browser storage{draft.protected ? ' · encrypted' : ''}</span>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn btn-primary" onclick={() => resumeDraft?.(draft.key)}>Resume</button>
            <button class="iconbtn danger" data-tip="Delete plan — removes it from this browser; doesn't touch any file you've already saved" data-tip-pos="left" aria-label="Delete plan" onclick={() => confirmDelete(draft.key)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </button>
          </div>
        </div>
      {/each}

      {#if error}
        <div class="error-slot"><Callout text={error} /></div>
      {/if}

      <input
        bind:this={fileInput}
        type="file"
        accept=".json,.zip,.html,application/json,application/zip,text/html"
        hidden
        onchange={(e) => handleAnyFileInput(e.target.files)}
      />
    </section>
  </main>

  <footer class="screen no-print">
    <div class="container row wrap">
      <span class="tiny">© 2026 OpenFirst™</span>
      <span class="tiny">Made with ❤ in Switzerland</span>
      <span class="spacer"></span>
      <nav class="row wrap footer-nav">
        {#if onHttp}
          <a class="tiny" href="/how-to-use/">How to use</a>
          <a class="tiny" href="/security/">Security</a>
          <a class="tiny" href="https://miroremias.com/projects/why-i-built-openfirst/" target="_blank" rel="noopener">The story</a>
        {/if}
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
    /* 22px, not the app-wide --gutter-mobile (18px) — matches the marketing
       pages' own mobile inset (see .home-main on /guides, /how-to-use) so
       "Your plans" lines up exactly under their eyebrow, not 4px left of it. */
    .topbar :global(.container),
    main.container,
    footer :global(.container) { padding-left: 22px; padding-right: 22px; }
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
  /* Same treatment as the marketing pages' topnav (site/index.html,
     how-to-use/index.html, etc.): "Download" is a real .btn there, not a
     plain link, so it matches here too rather than reading as just another
     nav item. */
  .nav-links, .nav-cta { display: contents; }
  .topnav .btn { min-height: 38px; padding: 8px 18px; font-size: 14px; }
  /* Small screens: nav drops to its own line under the logo (freedomclock-style). */
  @media (max-width: 760px) {
    .topbar > :global(.container) { height: auto; flex-wrap: wrap; row-gap: 2px; padding-top: 13px; padding-bottom: 9px; }
    .brand { flex: 1 0 100%; }
    /* min-height matches the mobile "Open the app" button's height on the
       other pages' topnav (34px) — without it, this page's link-only row is
       shorter than theirs and its links center higher, sitting visibly
       closer to the logo than the same links do elsewhere. */
    .topnav { flex: 1 0 100%; flex-wrap: wrap; gap: 10px 18px; min-height: 34px; }
    .nav-links { display: flex; gap: 18px; flex: 1 0 100%; }
    .nav-cta { display: flex; gap: 10px; flex: 1 0 100%; justify-content: flex-start; }
    .topnav a.btn { min-height: 34px; padding: 6px 14px; font-size: 13px; }
  }
  main { flex: 1; width: 100%; }
  /* 46px, not .home-main's own 40px: their eyebrow is an inline <span> in a
     plain <div>, so it inherits the body's line-height as leading above the
     first line; ours is a block <p>, which has none. +6px reproduces that
     leading so "Your plans" lands on the exact same row as their eyebrow. */
  .hero { padding: 46px 0 48px; }
  /* Matches the marketing pages' blue eyebrow (/guides, /how-to-use, etc.) —
     the app-wide .eyebrow in app.css is muted gray, smaller, and lighter-
     weight for in-app UI labels (dialog/panel headers), but this page is
     the site's own landing page. */
  .eyebrow { color: var(--accent-deep); font-size: 11.5px; font-weight: 600; letter-spacing: 0.13em; }
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

  /* Stand-alone launcher buttons, side by side, right under the lede — no
     boxed cards. Each carries its explainer as a data-tip hover hint instead
     of visible copy (see app.css's [data-tip] pattern); those hints run a
     full sentence rather than app.css's usual short label, so this overrides
     the shared bubble's nowrap/width to actually wrap. */
  .launcher-actions { display: flex; gap: 14px; margin-top: 22px; }
  .launcher-actions [data-tip]::after {
    white-space: normal; width: max-content; max-width: 260px; text-align: left; line-height: 1.4;
  }
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
  footer .tiny { color: var(--screen-px); }
  .footer-nav { gap: 16px; }
  .footer-nav a:hover { color: var(--accent); text-decoration: none; }
  .draft-lock { display: inline-flex; margin-right: 7px; color: var(--ink-soft); vertical-align: -1px; }

  @media (max-width: 480px) {
    .launcher-actions { flex-direction: column; align-items: flex-start; }
  }
  /* 640px/34px — matches .home-main's own mobile breakpoint (28px) plus the
     same +6px leading compensation as the desktop rule above. */
  @media (max-width: 640px) {
    .hero { padding-top: 34px; }
  }
</style>
