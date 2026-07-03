<script>
  import Landing from './components/Landing.svelte';
  import Reader from './components/Reader.svelte';
  import UnlockGate from './components/UnlockGate.svelte';
  import { Store } from './lib/store.svelte.js';
import { loadDraft, loadAllDrafts, clearDraft } from './lib/persist.js';
import { decryptAndLoad, loadSample } from './lib/load.js';
import { PACKAGE_SCHEMA } from './lib/format.js';
import { deriveDraftKey, decryptString, decryptToBlob } from './lib/draftcrypto.js';

  const store = new Store();

  // A self-contained reader file embeds the plan as window.__LIFE_PACKAGE__.
  const embedded = typeof window !== 'undefined' ? window.__LIFE_PACKAGE__ : null;
  const readerMode = !!embedded?.reader;
  let gateEnvelope = $state(null);

  let drafts = $state([]);

  // The same built file is served at /build/, /open/ and /demo/ — the path is
  // the boot mode. file:// (the exported reader, local test runs) never
  // matches, so double-clicked files always boot normally.
  const bootMode = (() => {
    if (readerMode || typeof location === 'undefined' || location.protocol === 'file:') return 'build';
    const m = /^\/(build|open|demo)\/?$/.exec(location.pathname);
    return m ? m[1] : 'build';
  })();
  let bootedDemo = false;

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
    if (bootMode === 'demo' && !bootedDemo) {
      // /demo boots straight into the sample plan.
      bootedDemo = true;
      (async () => { store.load(await loadSample()); window.scrollTo({ top: 0 }); })();
      return;
    }
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

  function onLoaded(loaded) { store.load(loaded); window.scrollTo({ top: 0 }); }
  function close() {
    store.reset();
    // Leaving a /demo or /open boot lands on the builder home, so a reload
    // doesn't re-trigger the boot mode.
    if (bootMode !== 'build' && location.protocol !== 'file:') {
      history.replaceState(null, '', '/build/');
    }
  }

  // Start a brand-new plan and drop straight into edit mode with a "Start here"
  // guide in a "General" group so the user knows where to begin.
  function newPlan() {
    const id = crypto?.randomUUID?.() || 'plan_' + Math.random().toString(36).slice(2);
    const today = new Date().toISOString().slice(0, 10);
    // Unique default name, same pattern as guides/groups: "My life package",
    // "My life package (1)"… when earlier plans already use the name.
    const taken = new Set(drafts.map((d) => d.title));
    let title = 'My life package';
    let n = 1;
    while (taken.has(title)) title = `My life package (${n++})`;
    const startHereContent = `## Welcome to your life package

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
      guide_groups: [{ id: 'grp_general', name: 'General', order: 0 }],
      guides: [{ id: 'guide_start', title: 'Start here', group: 'grp_general', order: 0, content: { en: startHereContent }, updated: today }],
      folders: [],
      attachments: []
    };
    store.load({ data, attachmentUrls: {}, blobs: new Map() });
    store.startEditing();
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
    <UnlockGate hint={gateEnvelope.hint} onUnlock={unlockEmbedded} />
  {/if}
{:else if store.pkg}
  <Reader {store} onClose={close} />
{:else if draftGate}
  <UnlockGate hint="Your draft passphrase (not the export password)." onUnlock={unlockDraft} onCancel={() => (draftGate = null)} />
{:else}
  <Landing {onLoaded} {newPlan} {drafts} {resumeDraft} {discardDraft} focus={bootMode === 'open' ? 'open' : ''} />
{/if}
