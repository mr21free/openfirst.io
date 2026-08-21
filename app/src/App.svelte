<script>
  import Landing from './components/Landing.svelte';
  import Reader from './components/Reader.svelte';
  import UnlockGate from './components/UnlockGate.svelte';
  import { Store, hasRealContent } from './lib/store.svelte.js';
  import { loadDraft, loadAllDrafts, clearDraft, getFileHandle, getAllFileHandles, deleteFileHandle } from './lib/persist.js';
  import { decryptAndLoad, loadSample } from './lib/load.js';
  import { PACKAGE_SCHEMA } from './lib/format.js';
  import { CONTAINER_FORMAT, parseContainerFromHtml, readContainer } from './lib/planfile.js';
  import { deriveDraftKey, decryptString, decryptToBlob } from './lib/draftcrypto.js';
  import { unwrapMasterKey } from './lib/slotcrypto.js';
  import { templateSeed } from './lib/templates.js';

  const store = new Store();

  // A self-contained reader file, or a plan file (Container Format v1 — see
  // FORMAT.md), embeds the plan as window.__LIFE_PACKAGE__. Opening a plan
  // file directly is always read-only — editing happens through the app.
  const embedded = typeof window !== 'undefined' ? window.__LIFE_PACKAGE__ : null;
  const readerMode = !!embedded?.reader || embedded?.format === 'lifepackage-plan/v1';
  let gateEnvelope = $state(null);
  let containerGate = $state(null); // a protected reader-mode plan file, until unlocked

  let drafts = $state([]);
  let recentPlans = $state([]);

  // The same built file is served at /build/, /open/ and /demo/ — the path is
  // the boot mode, each with ONE job:
  //   /open  → the launcher: your plans, resume, open a file (the start point)
  //   /build → the editor: boots straight into building a new plan when
  //            nothing is loaded; opening/resuming from /open lands here too
  //   /demo  → the sample plan, opened as the primary heir would see it
  // file:// (the exported reader, local test runs) never matches, so
  // double-clicked files always boot like the launcher.
  const onHttp = typeof location !== 'undefined' && location.protocol !== 'file:';
  const bootMode = (() => {
    if (readerMode || !onHttp) return 'open';
    const m = /^\/(build|open|demo)\/?$/.exec(location.pathname);
    return m ? m[1] : 'open';
  })();
  let booted = false; // the boot mode fires once, not on every return to the launcher

  // While a plan is open, the URL is the editor's (/build/) — like any app.
  function showEditorUrl() {
    if (onHttp && !readerMode && location.pathname !== '/build/') history.pushState(null, '', '/build/');
  }

  // Each tab remembers which plan it has open (drafts persist under the plan
  // id), so refreshing /build/ resumes that work instead of starting a fresh
  // plan — and doesn't scatter a new draft per reload.
  const CURRENT_PLAN_KEY = 'openfirst.currentPlan';
  function rememberCurrentPlan(id) { try { if (id) sessionStorage.setItem(CURRENT_PLAN_KEY, id); } catch { /* private mode */ } }
  function forgetCurrentPlan() { try { sessionStorage.removeItem(CURRENT_PLAN_KEY); } catch { /* private mode */ } }

  // Auto screen-lock: while a passphrase-protected plan is open, 10 minutes
  // without any interaction flushes the encrypted save and drops the master
  // key + plan content from memory — store.locked then shows the unlock gate
  // again in place, still connected to the same file/draft (see
  // store.svelte.js's lockDraft/loadLockedContainer/resumeAfterUnlock).
  const IDLE_LOCK_MS = 10 * 60 * 1000;
  $effect(() => {
    if (readerMode || !store.pkg || !store.protected) return;
    let t;
    const arm = () => { clearTimeout(t); t = setTimeout(() => store.lockDraft(), IDLE_LOCK_MS); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const e of evs) window.addEventListener(e, arm, { passive: true });
    arm();
    return () => { clearTimeout(t); for (const e of evs) window.removeEventListener(e, arm); };
  });

  // The Reader's Lock button — same lockDraft() the idle timeout uses.
  async function manualLock() {
    await store.lockDraft();
  }

  // The autosave write is debounced 50ms behind the last edit (see
  // store.svelte.js's #scheduleProcess) — a refresh or tab close inside that
  // window can lose the edit, since nothing has reached IndexedDB yet. Both
  // events fire reliably before that happens, so flush right away instead of
  // waiting out the debounce. (A visibilitychange-triggered flush isn't
  // reliably given time to finish before the page is torn down on a fast
  // same-tab reload — the real defense is the short debounce making the
  // write finish on its own well before that; this flush just covers the
  // remaining, much rarer window between an edit and the debounce firing.)
  $effect(() => {
    const flush = () => store.flushPendingChanges();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  });

  /** Try one passphrase against every slot of a raw (still-encrypted)
   *  container, decrypt it, and unpack it into the usual { data,
   *  attachmentUrls, blobs } shape — the one unlock path shared by reader
   *  boot, file reconnect, draft resume, and re-lock. Throws on total
   *  failure (every slot rejects it), which UnlockGate surfaces as a
   *  retryable error. */
  async function unlockContainer(rawContainer, passphrase) {
    const { masterKeyRaw } = await unwrapMasterKey({ slots: rawContainer.slots, passphrase, planId: rawContainer.planId });
    const loaded = await readContainer({ container: rawContainer, masterKeyRaw });
    return { ...loaded, masterKeyRaw };
  }

  async function unlockRelock(passphrase) {
    const rawContainer = await store.loadLockedContainer();
    if (!rawContainer) throw new Error('Could not find this plan to unlock.');
    const { data, attachmentUrls, blobs, masterKeyRaw } = await unlockContainer(rawContainer, passphrase);
    await store.resumeAfterUnlock({ data, attachmentUrls, blobs, masterKeyRaw });
  }

  async function unlockReaderContainer(passphrase) {
    const { data, attachmentUrls, blobs } = await unlockContainer(containerGate, passphrase);
    store.load({ data, attachmentUrls, blobs });
    containerGate = null;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function loadEmbeddedPlaintext(p) {
    const attachmentUrls = {};
    const blobs = new Map();
    const mimeFor = (id, embedded) => {
      if (embedded?.mime) return embedded.mime;
      const att = p.data?.attachments?.find((a) => a.id === id);
      const name = `${att?.original_filename || ''} ${att?.path || ''} ${att?.filename || ''}`.toLowerCase();
      if (/\.mp4\b/.test(name)) return 'video/mp4';
      if (/\.png\b/.test(name)) return 'image/png';
      if (/\.jpe?g\b/.test(name)) return 'image/jpeg';
      if (/\.webp\b/.test(name)) return 'image/webp';
      if (/\.gif\b/.test(name)) return 'image/gif';
      if (/\.pdf\b/.test(name)) return 'application/pdf';
      return att?.mime || '';
    };
    for (const [id, a] of Object.entries(p.attachments || {})) {
      const blob = new Blob([base64ToBytes(a.b64)], { type: mimeFor(id, a) });
      blobs.set(id, blob);
      attachmentUrls[id] = URL.createObjectURL(blob);
    }
    return { data: p.data, attachmentUrls, blobs };
  }


  // Boot. Reader mode loads the embedded plan (or shows the password gate).
  // Builder mode: every time the landing is shown (store.pkg is null), re-check
  // for a saved draft so "Resume" appears even after navigating home.
  $effect(() => {
    if (readerMode) {
      if (!store.pkg && !gateEnvelope && !containerGate) {
        if (embedded.format === 'lifepackage-plan/v1') {
          if (embedded.protection === 'none') {
            (async () => store.load(await readContainer({ container: embedded })))();
          } else {
            containerGate = embedded;
          }
        } else if (embedded.encrypted) {
          gateEnvelope = embedded.encrypted;
        } else {
          store.load(loadEmbeddedPlaintext(embedded));
        }
      }
      return;
    }
    if (store.pkg) return; // editing/reading — don't check
    if (!booted && bootMode === 'demo') {
      // /demo boots straight into the sample plan, read-only, as the admin —
      // so the Edit button is visible and a builder can discover it (and
      // Ctrl+E) instead of landing on a heir's locked-down view with no way out.
      booted = true;
      demoAdmin = true;
      const params = new URLSearchParams(location.search);
      const guideId = params.get('guide');
      if (guideId) templateView = guideId;
      const dryRunPersonId = params.get('dryrun');
      if (dryRunPersonId) demoDryRunPerson = dryRunPersonId;
      (async () => {
        const loaded = await loadSample();
        store.load(loaded);
        window.scrollTo({ top: 0 });
      })();
      return;
    }
    if (!booted && bootMode === 'build') {
      // /build with nothing loaded: resume the plan this tab was working on
      // (a refresh mustn't look like lost work), else start building fresh.
      // (An untouched new plan is never auto-saved, so stray visits don't
      // leave draft clutter.)
      // /build/?template=<id> seeds the new plan from a free template and
      // opens the template's own guide read-first, not the editor — the link
      // on /guides/ promises "read this template", editing is one click away.
      booted = true;
      const templateId = new URLSearchParams(location.search).get('template');
      (async () => {
        if (!templateId) {
          let key = null;
          try { key = sessionStorage.getItem(CURRENT_PLAN_KEY); } catch { /* private mode */ }
          if (key && await resumeDraft(key)) return;
          await newPlan();
          return;
        }
        const seed = templateSeed(templateId);
        if (seed?.guides?.[0]) templateView = seed.guides[0].id;
        await newPlan(seed);
        if (seed?.guides?.[0]) store.stopEditing();
      })();
      return;
    }
    booted = true;
    refreshDrafts();
  });

  // Iteration 2b: split into two lists. A plan with a remembered file
  // connection is "recent" (the file, not IndexedDB, is authoritative on
  // reconnect — see continueFileBackedPlan); iteration 3 gives
  // passphrase-protected plans real file-autosave too, so they can appear
  // here now (parked behind fileGate on Continue, not resumeDraft). Everything
  // else without a file connection is "unsaved" — the old draft list.
  async function refreshDrafts() {
    const [all, handles] = await Promise.all([loadAllDrafts(), getAllFileHandles()]);
    const usable = all.filter((d) => d.data || d.enc);
    const draftByKey = new Map(usable.map((d) => [d.key, d]));

    recentPlans = handles
      .map((h) => ({
        planId: h.planId,
        name: h.name,
        handle: h.handle || null,
        lastOpenedAt: h.lastOpenedAt,
        title: draftByKey.get(h.planId)?.title || draftByKey.get(h.planId)?.data?.package?.title || h.name,
        // The handle record's own `protected` flag (set on every open/reconnect,
        // see persist.js's putFileHandle) is authoritative and covers a plan
        // this browser has never edited yet. Fall back to the scratch draft's
        // enc/slots for older handle records saved before that flag existed.
        protected: h.protected ?? (draftByKey.get(h.planId)?.enc === 'v1' || !!draftByKey.get(h.planId)?.slots?.length)
      }))
      .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));

    const homedIds = new Set(handles.map((h) => h.planId));
    drafts = usable
      .filter((d) => !homedIds.has(d.key))
      .map((d) => ({
        key: d.key,
        savedAt: d.savedAt,
        protected: d.enc === 'v1' || !!d.slots?.length,
        title: d.title || d.data?.package?.title || 'Unnamed plan'
      }))
      .sort((a, b) => (b.savedAt || '') > (a.savedAt || '') ? 1 : -1);
  }

  async function unlockEmbedded(password) {
    const loaded = await decryptAndLoad(gateEnvelope, password);
    store.load(loaded);
    gateEnvelope = null;
  }

  let demoAdmin = $state(false);
  let templateView = $state(null); // guide id a /build/?template= link opens on
  let demoDryRunPerson = $state(null); // person id a /demo/?dryrun= link opens a dry run for

  // A remembered file handle whose permission wasn't silently re-grantable on
  // this reload — File System Access requires a user gesture to re-prompt, so
  // this sits here until the Reader's "Reconnect" button is clicked.
  let pendingReconnectHandle = $state(null);

  /** After a draft resumes, silently try to reconnect its remembered file
   *  handle (see FORMAT.md / planfile.js). Falls back to a pending-reconnect
   *  affordance when the browser needs a fresh user gesture to re-grant. */
  async function tryReconnectFile(key) {
    const rec = await getFileHandle(key);
    if (!rec) return;
    if (!rec.handle) {
      // Fallback (no File System Access) homing from an earlier session —
      // restore the "n changes since last download" bookkeeping only.
      store.fileName = rec.name;
      store.fileRevision = rec.fileRevision || 0;
      return;
    }
    try {
      const perm = await rec.handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await store.connectFileHandle(rec.handle, rec.name);
      } else {
        store.fileName = rec.name;
        store.fileRevision = rec.fileRevision || 0;
        pendingReconnectHandle = rec.handle;
      }
    } catch {
      /* the handle may no longer be valid (file moved/deleted) — leave the
         plan autosaving to IndexedDB only, same as before it was ever homed */
    }
  }

  /** The Reader's "Reconnect" button: File System Access requires a real user
   *  gesture to re-grant permission after a reload, so this can't run silently. */
  async function reconnectFile() {
    if (!pendingReconnectHandle) return;
    const handle = pendingReconnectHandle;
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      pendingReconnectHandle = null;
      await store.connectFileHandle(handle, store.fileName);
    }
  }

  // ?template= has done its job once the user starts editing the seeded plan —
  // drop it, so a refresh resumes the (now autosaving) draft instead of
  // re-seeding a fresh copy of the template over their work.
  $effect(() => {
    if (store.pkg && store.mode === 'edit' && onHttp && !readerMode && location.pathname === '/build/' && location.search) {
      history.replaceState(null, '', '/build/');
    }
  });

  function onLoaded(loaded) {
    store.load(loaded);
    // A plan opened but never edited still needs to show up in "your plans" —
    // see store.svelte.js's persistOnOpen (normal autosave only writes once a
    // real edit happens).
    store.persistOnOpen();
    rememberCurrentPlan(loaded.data?.package?.id);
    showEditorUrl();
    window.scrollTo({ top: 0 });
  }
  function close() {
    store.reset();
    forgetCurrentPlan();
    demoAdmin = false;
    pendingReconnectHandle = null;
    // The launcher's lists were last populated on boot (or the last time a
    // plan was opened) — refresh so a plan just opened/imported without any
    // edit, or reconnected to its file, shows up immediately instead of only
    // after a hard reload.
    refreshDrafts();
    // Closing a plan always lands on the launcher — and the URL says so.
    if (onHttp && !readerMode && location.pathname !== '/open/') {
      history.replaceState(null, '', '/open/');
    }
  }

  // Start a brand-new plan and drop straight into edit mode with a "Start here"
  // guide in a "General" group so the user knows where to begin.
  async function newPlan(seed = null) {
    const id = crypto?.randomUUID?.() || 'plan_' + Math.random().toString(36).slice(2);
    const today = new Date().toISOString().slice(0, 10);
    // Unique default name, same pattern as guides/groups: "My plan",
    // "My plan (1)"… when earlier plans already use the name. Read the titles
    // straight from the saved drafts — the local `drafts` list is only
    // populated on the launcher, and /build/ boots here directly.
    let taken;
    try {
      const all = await loadAllDrafts();
      taken = new Set(all.map((d) => (d.enc ? d.title : d.data?.package?.title)).filter(Boolean));
    } catch {
      taken = new Set(drafts.map((d) => d.title));
    }
    let title = seed?.title ? `My ${seed.title}` : 'My plan';
    let n = 1;
    while (taken.has(title)) title = `${seed?.title ? 'My ' + seed.title : 'My plan'} (${n++})`;
    const startHereContent = `## Welcome to your plan

This is your **Start here** guide. Edit it to write instructions for the people who will receive this plan.

Here's what to do next:

1. Go to **People** (left nav) and add everyone who should receive this plan.
2. Go to **Roles** and assign roles — for example "Primary heir" or "Beneficiary".
3. Add **Locations** for physical places: countries, homes, safe deposit boxes, hardware wallets.
4. Add **Items** for accounts, keys, Bitcoin wallets, documents, and other assets.
5. Upload **Files** — scans, photos, certificates — in the Files section.
6. Add more **Guides** (use "+ New guide" below) to write detailed instructions for each topic.

When you are done, click **Export** in the top bar to save a plan your heirs can open.`;
    const data = {
      schema: PACKAGE_SCHEMA,
      package: { id, title, owner_id: 'person_owner', created: today, updated: today, languages: ['en'], default_language: 'en' },
      people: [{ id: 'person_owner', name: 'Me', roles: ['owner'] }],
      roles: [
        { id: 'owner', name: 'Owner' },
        { id: 'primary_heir', name: 'Primary heir' },
        { id: 'beneficiary', name: 'Beneficiary' },
        { id: 'professional', name: 'Professional' },
        { id: 'friend', name: 'Friend' }
      ],
      locations: [],
      items: [],
      guide_groups: [{ id: 'grp_general', name: 'General', order: 0 }, ...(seed?.guide_groups || []).map((g, i) => ({ ...g, order: i + 1 }))],
      guides: [
        { id: 'guide_start', title: 'Start here', group: 'grp_general', order: 0, content: { en: startHereContent }, updated: today },
        ...(seed?.guides || []).map((g) => ({ ...g, updated: today }))
      ],
      folders: [],
      attachments: []
    };
    store.load({ data, attachmentUrls: {}, blobs: new Map() });
    store.startEditing();
    store.persistOnOpen();
    rememberCurrentPlan(id);
    showEditorUrl();
    window.scrollTo({ top: 0 });
  }

  // A protected draft being resumed: hold it until the passphrase is entered.
  // `kind: 'migrate'` is the old single-passphrase scheme (unlocks, then
  // re-wraps into a fresh slot); `kind: 'unlock'` is the current multi-slot one.
  let draftGate = $state(null); // { key, kind, slots? } | null

  /** Resume a saved draft. Returns true when the draft was found (including
   *  the protected case, which parks it behind the passphrase gate). */
  async function resumeDraft(key) {
    const d = await loadDraft(key);
    if (!d) return false;
    if (d.enc === 'v1') { draftGate = { key, kind: 'migrate' }; return true; } // needs the passphrase
    if (d.slots?.length) { draftGate = { key, kind: 'unlock', slots: d.slots }; return true; }
    if (!d.data) return false;
    const attachmentUrls = {};
    const blobs = new Map();
    const mimeFor = (id) => {
      const att = d.data?.attachments?.find((a) => a.id === id);
      const name = `${att?.original_filename || ''} ${att?.path || ''} ${att?.filename || ''}`.toLowerCase();
      if (/\.mp4\b/.test(name)) return 'video/mp4';
      return att?.mime || '';
    };
    for (const a of d.attachments || []) {
      if (a.blob) {
        const blob = a.blob.type ? a.blob : a.blob.slice(0, a.blob.size, mimeFor(a.id));
        blobs.set(a.id, blob);
        attachmentUrls[a.id] = URL.createObjectURL(blob);
      }
    }
    // Blobs loaded from the new per-blob store are already persisted; legacy
    // (inline) blobs must be written to it on the first save.
    store.load({
      data: d.data, attachmentUrls, blobs, persistedDraft: !d.legacyBlobs,
      revision: d.revision || 0, hasAddedEntity: !!d.hasAddedEntity || hasRealContent(d.data)
    });
    store.startEditing();
    rememberCurrentPlan(key);
    showEditorUrl();
    drafts = [];
    window.scrollTo({ top: 0 });
    await tryReconnectFile(key);
    return true;
  }

  // A protected file-backed plan (recent-plans Continue, or Locate it), held
  // until the passphrase is entered.
  let fileGate = $state(null); // { container, handle, name, planId } | null

  async function unlockFileGate(passphrase) {
    const { container, handle, name, planId } = fileGate;
    const { data, attachmentUrls, blobs, masterKeyRaw } = await unlockContainer(container, passphrase);
    rememberCurrentPlan(planId);
    await store.openFromFile({ data, attachmentUrls, blobs }, container.revision, handle, name, { masterKeyRaw, slots: container.slots });
    showEditorUrl();
    drafts = [];
    recentPlans = [];
    fileGate = null;
    window.scrollTo({ top: 0 });
  }

  /** The launcher's "recent plans" Continue button (iteration 2b): the file
   *  is authoritative for a file-backed plan (see store.svelte.js's
   *  `openFromFile`) — protected or not. Returns false on any failure so the
   *  row can show "Locate it" / "Restore from backup" instead. */
  async function continueFileBackedPlan(rec) {
    if (!rec.handle) return resumeDraft(rec.planId); // fallback homing: no live handle to read
    try {
      let perm = await rec.handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await rec.handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
      const text = await (await rec.handle.getFile()).text();
      const container = parseContainerFromHtml(text);
      if (!container || container.format !== CONTAINER_FORMAT) return false;
      if (container.protection === 'passphrase') {
        fileGate = { container, handle: rec.handle, name: rec.name, planId: rec.planId };
        return true;
      }
      const loaded = await readContainer({ container });
      rememberCurrentPlan(rec.planId);
      await store.openFromFile(loaded, container.revision, rec.handle, rec.name);
      showEditorUrl();
      drafts = [];
      recentPlans = [];
      window.scrollTo({ top: 0 });
      return true;
    } catch {
      return false;
    }
  }

  /** Shared by "Locate it" (expects a specific planId, rejects any other
   *  plan) and Landing's "Open existing plan" when a .html is picked
   *  (expectedPlanId null — any valid container-v1 .html this browser has
   *  never seen is fine). Either way the
   *  picked handle becomes this plan's live connection, the same as
   *  reconnecting a recent plan — passphrase-protected containers still park
   *  behind fileGate for UnlockGate to handle. */
  async function openPickedFileHandle(handle, expectedPlanId) {
    try {
      const text = await (await handle.getFile()).text();
      const container = parseContainerFromHtml(text);
      if (!container || container.format !== CONTAINER_FORMAT) return false;
      if (expectedPlanId && container.planId !== expectedPlanId) return 'mismatch';
      if (container.protection === 'passphrase') {
        fileGate = { container, handle, name: handle.name, planId: container.planId };
        return true;
      }
      const loaded = await readContainer({ container });
      rememberCurrentPlan(container.planId);
      await store.openFromFile(loaded, container.revision, handle, handle.name);
      showEditorUrl();
      drafts = [];
      recentPlans = [];
      window.scrollTo({ top: 0 });
      return true;
    } catch {
      return false;
    }
  }

  /** Row-level "Locate it": the file moved/was deleted, so the user picks it
   *  by hand — re-associates the picked handle with the same planId. A
   *  container's `planId` travels with its own content (set once, at
   *  creation — see planfile.js's `buildContainer`), independent of the
   *  file's current name on disk, so a plain rename is transparently fine
   *  here. Picking an unrelated plan's file is not: returns the sentinel
   *  'mismatch' instead of `false` so the row can say so specifically,
   *  rather than implying the original file still just can't be found. */
  async function locateFileForPlan(planId) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'OpenFirst plan', accept: { 'text/html': ['.html'] } }]
      });
    } catch {
      return false; // user cancelled the picker
    }
    return openPickedFileHandle(handle, planId);
  }

  /** Landing's single "Open existing plan" button, when a .html was the file
   *  picked (via File System Access — Landing runs one combined-type picker
   *  covering .html/.json/.zip and routes here for the .html case): reconnect
   *  it live, so autosave keeps writing back into that same file going
   *  forward — same mechanism as reconnecting a recent plan, just without an
   *  existing planId to match against. */
  async function openPickedHtmlHandle(handle) {
    return openPickedFileHandle(handle, null);
  }

  // A protected .html opened with no live handle to keep (Landing's plain
  // <input> fallback on browsers without File System Access) — held until the
  // passphrase is entered, same UI as fileGate but resolves to a one-time,
  // non-file-backed import (see importHtmlOneTime below).
  let importGate = $state(null); // { container } | null

  async function unlockImportGate(passphrase) {
    const { container } = importGate;
    const { data, attachmentUrls, blobs, masterKeyRaw } = await unlockContainer(container, passphrase);
    store.load({ data, attachmentUrls, blobs, masterKeyRaw, slots: container.slots, revision: container.revision, hasAddedEntity: true });
    store.startEditing();
    store.persistOnOpen();
    rememberCurrentPlan(container.planId);
    showEditorUrl();
    importGate = null;
    window.scrollTo({ top: 0 });
  }

  /** Landing's "Open existing plan" fallback for browsers without File
   *  System Access: a plain <input type=file> can't hand back a live handle,
   *  so a picked .html gets the same one-time-copy treatment as a .json/.zip
   *  backup — no file association at all (never calls store.openFromFile /
   *  putFileHandle), so it lands as a normal in-browser draft, not a
   *  "recent" file-backed entry with a handle that doesn't exist. Passphrase
   *  protection is still preserved in-browser (a strictly safer superset of
   *  "just like a .json import", which never carries protection to begin
   *  with since plain JSON has nowhere to keep it). */
  async function importHtmlOneTime(file) {
    let text;
    try { text = await file.text(); } catch { return false; }
    const container = parseContainerFromHtml(text);
    if (!container || container.format !== CONTAINER_FORMAT) return false;
    if (container.protection === 'passphrase') {
      importGate = { container };
      return true;
    }
    const loaded = await readContainer({ container });
    store.load({ ...loaded, revision: container.revision, hasAddedEntity: true });
    store.startEditing();
    store.persistOnOpen();
    rememberCurrentPlan(container.planId);
    showEditorUrl();
    window.scrollTo({ top: 0 });
    return true;
  }

  /** Row-level "Restore from backup": the file's really gone — drop the
   *  broken connection and fall back to the local crash-scratch, if any. */
  async function restoreFromMissingHandle(planId) {
    await deleteFileHandle(planId);
    const found = await resumeDraft(planId);
    if (!found) await refreshDrafts(); // nothing left at all — just drop the row
  }

  /** "Delete" for a recent (file-backed) row: always removes the plan from
   *  this browser (file connection + crash-scratch). When `alsoDeleteFile`
   *  is set (Landing's checkbox — only offerable when there's a live handle
   *  to begin with) it also best-effort deletes the actual file via the File
   *  System Access API's handle.remove(), which needs the same readwrite
   *  permission as writing to it. Deletion of the app's own records always
   *  proceeds even if the file removal fails (permission denied, already
   *  gone) — the user asked to delete the plan either way. Returns an error
   *  message when the file itself couldn't be removed, so the caller can
   *  tell the user instead of silently pretending it worked. */
  async function deleteRecentPlan(planId, alsoDeleteFile) {
    let fileDeleteError = null;
    if (alsoDeleteFile) {
      const rec = recentPlans.find((r) => r.planId === planId);
      if (rec?.handle) {
        try {
          let perm = await rec.handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await rec.handle.requestPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            if (typeof rec.handle.remove === 'function') {
              await rec.handle.remove();
            } else {
              fileDeleteError = "This browser doesn't support deleting files from a web page.";
            }
          } else {
            fileDeleteError = 'Permission to modify the file was not granted.';
          }
        } catch (e) {
          fileDeleteError = e?.message || String(e);
          console.error('deleteRecentPlan: failed to remove file on disk', e);
        }
      }
    }
    await deleteFileHandle(planId);
    await clearDraft(planId);
    await refreshDrafts();
    return fileDeleteError;
  }

  // Migration path: a draft still protected under the old, pre-iteration-3
  // single-passphrase scheme (draftcrypto.js). Unlocks it exactly as before,
  // then immediately re-wraps the decrypted plan into a fresh slot under the
  // new scheme (same passphrase, default label, no hint) — this record never
  // goes back through the old shape. Throws on a wrong passphrase (AES-GCM
  // auth fails), which UnlockGate surfaces as a friendly error.
  async function unlockAndMigrateDraft(passphrase) {
    const key = draftGate.key;
    const d = await loadDraft(key);
    const cryptoKey = await deriveDraftKey(passphrase, new Uint8Array(d.salt), d.iterations);
    const json = await decryptString(cryptoKey, key, new Uint8Array(d.iv), new Uint8Array(d.ct));
    const data = JSON.parse(json);
    const attachmentUrls = {};
    const blobs = new Map();
    for (const a of d.attachments || []) {
      const blob = await decryptToBlob(cryptoKey, key, a.blob);
      blobs.set(a.id, blob);
      attachmentUrls[a.id] = URL.createObjectURL(blob);
    }
    store.load({ data, attachmentUrls, blobs, persistedDraft: true, revision: d.revision || 0, hasAddedEntity: !!d.hasAddedEntity || hasRealContent(data) });
    store.startEditing();
    await store.protectPlan(passphrase, 'Passphrase', '');
    rememberCurrentPlan(key);
    showEditorUrl();
    draftGate = null;
    drafts = [];
    window.scrollTo({ top: 0 });
  }

  // A draft protected under the current multi-slot scheme (slotcrypto.js).
  async function unlockProtectedDraft(passphrase) {
    const key = draftGate.key;
    const rawContainer = await loadDraft(key);
    const { data, attachmentUrls, blobs, masterKeyRaw } = await unlockContainer(rawContainer, passphrase);
    store.load({
      data, attachmentUrls, blobs, persistedDraft: true, masterKeyRaw, slots: rawContainer.slots,
      revision: rawContainer.revision || 0, hasAddedEntity: !!rawContainer.hasAddedEntity || hasRealContent(data)
    });
    store.startEditing();
    rememberCurrentPlan(key);
    showEditorUrl();
    draftGate = null;
    drafts = [];
    window.scrollTo({ top: 0 });
  }

  async function discardDraft(key) {
    await clearDraft(key);
    drafts = drafts.filter((d) => d.key !== key);
  }
</script>

{#if readerMode}
  {#if store.pkg}
    <Reader {store} readOnly onClose={() => {}} />
  {:else if gateEnvelope}
    <UnlockGate hint={gateEnvelope.hint} onUnlock={unlockEmbedded} term="password" />
  {:else if containerGate}
    <UnlockGate slots={containerGate.slots} onUnlock={unlockReaderContainer} />
  {/if}
{:else if store.pkg}
  <Reader {store} onClose={close} onLock={manualLock} initialAdmin={demoAdmin} initialView={templateView} initialDryRunPerson={demoDryRunPerson} isDemo={demoAdmin} {pendingReconnectHandle} {reconnectFile} />
{:else if store.locked}
  <UnlockGate slots={store.slots} onUnlock={unlockRelock} onCancel={close} />
{:else if draftGate}
  <UnlockGate
    hint={draftGate.kind === 'migrate' ? 'Your plan passphrase (not the export password).' : ''}
    slots={draftGate.kind === 'unlock' ? draftGate.slots : null}
    onUnlock={draftGate.kind === 'migrate' ? unlockAndMigrateDraft : unlockProtectedDraft}
    onCancel={() => { draftGate = null; refreshDrafts(); }}
  />
{:else if fileGate}
  <UnlockGate slots={fileGate.container.slots} onUnlock={unlockFileGate} onCancel={() => (fileGate = null)} />
{:else if importGate}
  <UnlockGate slots={importGate.container.slots} onUnlock={unlockImportGate} onCancel={() => (importGate = null)} />
{:else}
  <Landing
    {onLoaded} {newPlan} {drafts} {resumeDraft} {discardDraft}
    {recentPlans}
    continueRecent={continueFileBackedPlan}
    locateRecent={locateFileForPlan}
    openPickedHtmlHandle={openPickedHtmlHandle}
    importHtmlOneTime={importHtmlOneTime}
    restoreRecentFromBackup={restoreFromMissingHandle}
    deleteRecent={deleteRecentPlan}
  />
{/if}
