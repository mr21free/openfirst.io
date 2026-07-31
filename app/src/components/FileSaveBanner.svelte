<script>
  /*
    File-autosave surface: a thin, ambient bottom status bar showing where this
    plan lives on disk and how fresh it is, plus the "homing" prompt and the
    fallback "Download new copy" button for browsers without File System
    Access. See FORMAT.md's Container Format v1 and store.svelte.js's
    file-write methods.

    Design rule: a successful save is not an event worth announcing — it's the
    permanent background condition, so it gets quiet, static, state-grammar
    text ("plan.html · saved 2 min ago") rather than a colored banner shouting
    "Saved!". Color and motion are reserved for the states that actually need
    a decision: nothing saved anywhere yet, a stuck write, or a pending manual
    update. See DESIGN.md for the "ambient success, escalate only danger" rule.

    Passphrase-protected plans get real file-autosave too (slotcrypto.js
    encrypts the file itself), so they flow through the same states below as
    unprotected ones.
  */
  import { suggestedFileName } from '../lib/planfile.js';
  import { APP_VERSION } from '../lib/version.js';
  import { APP_DOMAIN } from '../lib/format.js';
  import InfoHint from './InfoHint.svelte';

  let { store, isDemo = false, pendingReconnectHandle = null, onReconnect = null } = $props();

  const fsaSupported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  // This same component ships inside every downloaded plan file too (the app
  // is embedded verbatim), so one runtime check covers both places: hosted on
  // openfirst.io is always the latest build by definition, so the version/
  // update control only earns its keep in a standalone .html, which can go
  // stale sitting on someone's disk.
  const isHosted = typeof window !== 'undefined' && window.location.hostname === APP_DOMAIN;

  let busy = $state(false);
  let error = $state('');

  // Ambient version display, edit mode only (this whole bar is builder-only —
  // an heir reading the plan never needs to know the app version). Checking
  // for updates is the app's only network request, and only on click.
  let updateState = $state('idle'); // idle | checking | current | available | error
  let latestVersion = $state('');
  let errorReason = $state('');
  async function checkForUpdate() {
    updateState = 'checking';
    errorReason = '';
    try {
      const res = await fetch(`https://${APP_DOMAIN}/version.json`, { cache: 'no-store' });
      if (!res.ok) { errorReason = 'not published here'; throw new Error(); }
      const { version } = await res.json();
      if (!version) { errorReason = 'unexpected response'; throw new Error(); }
      latestVersion = version;
      updateState = version !== APP_VERSION ? 'available' : 'current';
    } catch {
      if (!errorReason) errorReason = 'offline?';
      updateState = 'error';
    }
  }

  // The "saved N ago" text ages on its own between edits — nothing else
  // re-renders this component while the plan sits idle, so a slow tick keeps
  // it honest without ever needing a "Saving…" transition state.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { now = Date.now(); }, 30000);
    return () => clearInterval(id);
  });

  function timeAgo(iso) {
    if (!iso) return '';
    const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  async function chooseLocation() {
    error = '';
    const name = suggestedFileName(store.data?.package?.title);
    if (fsaSupported) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'OpenFirst plan', accept: { 'text/html': ['.html'] } }]
        });
        busy = true;
        await store.connectFileHandle(handle, handle.name, { force: true });
      } catch (err) {
        if (err?.name !== 'AbortError') error = "Couldn't save to that location.";
      } finally {
        busy = false;
      }
      return;
    }
    busy = true;
    try {
      await store.downloadFileNow(name);
    } finally {
      busy = false;
    }
  }

  async function updateFile() {
    busy = true;
    try {
      await store.downloadFileNow();
    } finally {
      busy = false;
    }
  }

  async function retry() {
    busy = true;
    try {
      await store.retryFileWrite();
    } finally {
      busy = false;
    }
  }

  async function reconnect() {
    busy = true;
    try {
      await onReconnect?.();
    } finally {
      busy = false;
    }
  }

  async function restoreBackup() {
    busy = true;
    try {
      await store.restoreScratchBackup();
    } finally {
      busy = false;
    }
  }

  async function useFileInstead() {
    busy = true;
    try {
      await store.useFileInstead();
    } finally {
      busy = false;
    }
  }
</script>

{#snippet versionTag()}
  <span class="fs-version">
    <span class="fs-version-num">v{APP_VERSION}</span>
    {#if !isHosted}
      {#if updateState === 'available'}
        <!-- A plain button can't hand you the new file — send you to the site,
             where the top-nav "Download" link is same-origin and can. New tab
             so it doesn't disturb whatever you're editing right now. -->
        <a class="fs-check" href={`https://${APP_DOMAIN}/`} target="_blank" rel="noopener">v{latestVersion} available — get it</a>
      {:else}
        <button class="fs-check" onclick={checkForUpdate} disabled={updateState === 'checking'}>
          {#if updateState === 'checking'}Checking…
          {:else if updateState === 'current'}up to date
          {:else if updateState === 'error'}couldn't check — {errorReason}
          {:else}check for updates{/if}
        </button>
      {/if}
    {/if}
  </span>
{/snippet}

{#if !isDemo && store.hasAddedEntity}
  {#if pendingReconnectHandle}
    <div class="filestatus warn no-print" role="status">
      <span class="fs-left"><span class="fs-file">{store.fileName}</span> needs permission again after reloading.</span>
      <button class="btn btn-ghost btn-small" disabled={busy} onclick={reconnect}>Reconnect</button>
      {@render versionTag()}
    </div>
  {:else if store.scratchAheadBy > 0}
    <div class="filestatus warn no-print" role="status">
      <span class="fs-left">Browser backup is newer than your file ({store.scratchAheadBy} change{store.scratchAheadBy === 1 ? '' : 's'} ahead).</span>
      <div class="row" style="gap:8px">
        <button class="btn btn-ghost btn-small" disabled={busy} onclick={useFileInstead}>Use file instead</button>
        <button class="btn btn-primary btn-small" disabled={busy} onclick={restoreBackup}>Restore backup</button>
      </div>
      {@render versionTag()}
    </div>
  {:else if !store.fileName}
    <div class="filestatus warn no-print" role="status">
      <span class="fs-left">
        <span class="fs-long">Browser only · temporary · not saved to any file.</span>
        <span class="fs-short">Not saved to a file yet.</span>
      </span>
      <div class="row" style="gap:2px">
        <button class="btn btn-primary btn-small" disabled={busy} onclick={chooseLocation}>
          {fsaSupported ? 'Save' : 'Download'}
        </button>
        {#if !fsaSupported}
          <InfoHint text="Each download is a standalone copy — your work itself stays saved in this browser. Use the newest download if you need a file to share or back up. On iPhone/iPad, reopen it by coming back here and using “Open existing plan”, not by tapping the file straight from Downloads." label="About this download" pos="left" />
        {/if}
      </div>
      {#if error}<span class="err">{error}</span>{/if}
      {@render versionTag()}
    </div>
  {:else if store.fileWriteFailed}
    <div class="filestatus warn no-print" role="status">
      <span class="fs-left">Couldn't save your last changes to <span class="fs-file">{store.fileName}</span>.</span>
      <button class="btn btn-ghost btn-small" disabled={busy} onclick={retry}>Retry</button>
      {@render versionTag()}
    </div>
  {:else if store.needsManualFileUpdate}
    <div class="filestatus warn no-print" role="status">
      <span class="fs-left">
        <span class="fs-long"><span class="fs-file">{store.fileName}</span> is behind by {store.pendingFileChanges} change{store.pendingFileChanges === 1 ? '' : 's'} — this browser can only save by downloading a new copy.</span>
        <span class="fs-short"><span class="fs-file">{store.fileName}</span> · {store.pendingFileChanges} unsaved change{store.pendingFileChanges === 1 ? '' : 's'}</span>
      </span>
      <div class="row" style="gap:2px">
        <button class="btn btn-primary btn-small" disabled={busy} onclick={updateFile}>Download</button>
        <InfoHint text="This browser can only save by downloading a fresh copy each time — it can't write to the same file in place. Each download is standalone; your work itself stays saved in this browser too. On iPhone/iPad, reopen it by coming back here and using “Open existing plan”, not by tapping the file straight from Downloads." label="About this download" pos="left" />
      </div>
      {@render versionTag()}
    </div>
  {:else}
    <div class="filestatus ok no-print" role="status">
      <span class="fs-left"><span class="fs-file">{store.fileName}</span> · {store.fileSavedAt ? `saved ${timeAgo(store.fileSavedAt)}` : 'up to date'}</span>
      {@render versionTag()}
    </div>
  {/if}
{/if}

<style>
  /* Ambient, always-on-screen fact — not a notification. Fixed to the
     viewport's bottom edge (desktop status-bar convention: VS Code, Word,
     Excel) rather than stacked above the app chrome, so it never competes
     with content or navigation for attention. No transitions/animation on
     any of this — the whole point is that it doesn't move or flash. */
  .filestatus {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: var(--z-topbar);
    display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: flex-start;
    padding: 5px 18px;
    /* Same height in every state (quiet text-only vs. a row with a button)
       so anything pinned above it (the action rail's Settings button) can
       rely on one fixed clearance instead of measuring — see Reader.svelte's
       --filestatus-h. Matches the tallest state: border-top(1) + padding(10)
       + .btn-small's 34px. */
    min-height: 45px;
    font-size: 12.5px; line-height: 1.4;
    background: var(--paper);
    color: var(--ink-mute);
    border-top: 1px solid var(--rule-soft);
  }
  .fs-file { font-family: var(--mono); }
  .filestatus.warn {
    color: oklch(0.35 0.06 60);
    background: var(--warn-wash);
    border-top-color: oklch(0.82 0.07 70);
  }
  :global([data-theme='dark']) .filestatus.warn {
    background: oklch(0.32 0.05 70);
    color: oklch(0.9 0.04 80);
    border-top-color: oklch(0.45 0.06 70);
  }
  .filestatus .err { color: oklch(0.5 0.18 30); font-size: 12px; }
  .filestatus button { flex: none; }

  /* Version + check-for-updates: sits quietly at the far right. The version
     number itself is plain, static text — only "check for updates" (and its
     checking/current/available/error states) is interactive, styled like
     plain ambient text (not a call-to-action button) until you actually
     click it — matches this bar's "nothing here shouts" design rule. */
  .fs-version {
    margin-left: auto;
    display: flex; align-items: center; gap: 6px;
    font-size: 12px;
  }
  .fs-version-num { font-family: var(--mono); opacity: 0.7; }
  .fs-check {
    border: none; background: none; padding: 0;
    color: inherit; opacity: 0.7;
    font: inherit; font-size: 12px;
    cursor: pointer;
  }
  .fs-check:hover:not(:disabled) { opacity: 1; text-decoration: underline; }
  .fs-check:disabled { cursor: default; }

  /* Two states' descriptive text has both a fuller desktop phrasing and a
     shorter mobile one — swap which shows rather than trimming the same
     string everywhere, since desktop has room to spare and mobile doesn't. */
  .fs-short { display: none; }

  @media (max-width: 820px) {
    /* The mobile action rail already owns the true bottom edge as a fixed
       tab bar (see Reader.svelte's .actionbar) — sit just above it instead
       of underneath it. */
    .filestatus { bottom: calc(var(--actionbar-h) + env(safe-area-inset-bottom)); }
    .fs-long { display: none; }
    .fs-short { display: inline; }
  }
</style>
