<script>
  import Landing from './components/Landing.svelte';
  import Reader from './components/Reader.svelte';
  import UnlockGate from './components/UnlockGate.svelte';
  import { Store } from './lib/store.svelte.js';
import { loadDraft, loadAllDrafts, clearDraft } from './lib/persist.js';
import { decryptAndLoad, loadSample } from './lib/load.js';
import { PACKAGE_SCHEMA } from './lib/format.js';
import { deriveDraftKey, decryptString, decryptToBlob } from './lib/draftcrypto.js';
import { templateSeed } from './lib/templates.js';

  const store = new Store();

  // A self-contained reader file embeds the plan as window.__LIFE_PACKAGE__.
  const embedded = typeof window !== 'undefined' ? window.__LIFE_PACKAGE__ : null;
  const readerMode = !!embedded?.reader;
  let gateEnvelope = $state(null);

  let drafts = $state([]);

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

  // Auto screen-lock: while a passphrase-protected plan is open, 10 minutes
  // without any interaction flushes the encrypted save, drops the key and the
  // plan from memory, and returns to the start. Free with draft protection —
  // it completes the security story (see DESIGN/strategy notes).
  const IDLE_LOCK_MS = 10 * 60 * 1000;
  let lockedNotice = $state(false);
  $effect(() => {
    if (readerMode || !store.pkg || !store.draftProtected) return;
    let t;
    const lock = async () => { await store.lockDraft(); lockedNotice = true; };
    const arm = () => { clearTimeout(t); t = setTimeout(lock, IDLE_LOCK_MS); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const e of evs) window.addEventListener(e, arm, { passive: true });
    arm();
    return () => { clearTimeout(t); for (const e of evs) window.removeEventListener(e, arm); };
  });

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
      if (!store.pkg && !gateEnvelope) {
        if (embedded.encrypted) gateEnvelope = embedded.encrypted;
        else store.load(loadEmbeddedPlaintext(embedded));
      }
      return;
    }
    if (store.pkg) return; // editing/reading — don't check
    if (!booted && bootMode === 'demo') {
      // /demo boots straight into the sample plan, read as the primary heir.
      booted = true;
      (async () => {
        const loaded = await loadSample();
        demoAudience = loaded.data?.package?.primary_person_ids?.[0] || null;
        store.load(loaded);
        window.scrollTo({ top: 0 });
      })();
      return;
    }
    if (!booted && bootMode === 'build') {
      // /build with nothing loaded = start building. (An untouched new plan is
      // never auto-saved, so stray visits don't leave draft clutter.)
      // /build/?template=<id> seeds the new plan from a free template and
      // opens the template's own guide read-first, not the editor — the link
      // on /guides/ promises "read this template", editing is one click away.
      booted = true;
      const seed = templateSeed(new URLSearchParams(location.search).get('template'));
      newPlan(seed);
      if (seed?.guides?.[0]) {
        store.stopEditing();
        templateView = seed.guides[0].id;
      }
      return;
    }
    booted = true;
    (async () => {
      const all = await loadAllDrafts();
      drafts = all
        .filter((d) => d.data || d.enc)
        .map((d) => ({
          key: d.key,
          savedAt: d.savedAt,
          protected: d.enc === 'v1',
          title: (d.enc ? d.title : d.data?.package?.title) || 'Unnamed plan'
        }))
        .sort((a, b) => (b.savedAt || '') > (a.savedAt || '') ? 1 : -1);
    })();
  });

  async function unlockEmbedded(password) {
    const loaded = await decryptAndLoad(gateEnvelope, password);
    store.load(loaded);
    gateEnvelope = null;
  }

  let demoAudience = $state(null);
  let templateView = $state(null); // guide id a /build/?template= link opens on

  function onLoaded(loaded) { store.load(loaded); showEditorUrl(); window.scrollTo({ top: 0 }); }
  function close() {
    store.reset();
    demoAudience = null;
    // Closing a plan always lands on the launcher — and the URL says so.
    if (onHttp && !readerMode && location.pathname !== '/open/') {
      history.replaceState(null, '', '/open/');
    }
  }

  // Start a brand-new plan and drop straight into edit mode with a "Start here"
  // guide in a "General" group so the user knows where to begin.
  function newPlan(seed = null) {
    const id = crypto?.randomUUID?.() || 'plan_' + Math.random().toString(36).slice(2);
    const today = new Date().toISOString().slice(0, 10);
    // Unique default name, same pattern as guides/groups: "My plan",
    // "My plan (1)"… when earlier plans already use the name.
    const taken = new Set(drafts.map((d) => d.title));
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
    showEditorUrl();
    window.scrollTo({ top: 0 });
  }

  // A protected draft being resumed: hold it until the passphrase is entered.
  let draftGate = $state(null); // { key } | null

  async function resumeDraft(key) {
    const d = await loadDraft(key);
    if (!d) return;
    if (d.enc === 'v1') { draftGate = { key }; return; } // needs the passphrase
    if (!d.data) return;
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
    store.load({ data: d.data, attachmentUrls, blobs, persistedDraft: !d.legacyBlobs });
    store.startEditing();
    showEditorUrl();
    drafts = [];
    window.scrollTo({ top: 0 });
  }

  // Decrypt-and-open a protected draft. Throws on a wrong passphrase (AES-GCM
  // auth fails), which UnlockGate surfaces as a friendly error.
  async function unlockDraft(passphrase) {
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
    store.load({ data, attachmentUrls, blobs, persistedDraft: true, draftKey: cryptoKey, draftSalt: new Uint8Array(d.salt) });
    store.startEditing();
    showEditorUrl();
    draftGate = null;
    lockedNotice = false;
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
    <UnlockGate hint={gateEnvelope.hint} onUnlock={unlockEmbedded} />
  {/if}
{:else if store.pkg}
  <Reader {store} onClose={close} initialAudience={demoAudience} initialView={templateView} />
{:else if draftGate}
  <UnlockGate hint="Your draft passphrase (not the export password)." onUnlock={unlockDraft} onCancel={() => (draftGate = null)} />
{:else}
  {#if lockedNotice}
    <div class="locked-note no-print" role="status">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      Locked after 10 minutes of inactivity. Your encrypted draft is saved — resume to continue.
      <button class="iconbtn locked-x" data-tip="Dismiss" data-tip-pos="left" aria-label="Dismiss" onclick={() => (lockedNotice = false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
    </div>
  {/if}
  <Landing {onLoaded} {newPlan} {drafts} {resumeDraft} {discardDraft} />
{/if}

<style>
  .locked-note {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 18px; font-size: 13px;
    background: var(--accent-wash); color: var(--ink-soft);
    border-bottom: 1px solid var(--rule);
  }
  .locked-note svg:first-child { flex: none; color: var(--accent-deep); }
  .locked-x { width: 28px; height: 28px; margin-left: auto; }
</style>
