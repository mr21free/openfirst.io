<script>
  import Landing from './components/Landing.svelte';
  import Reader from './components/Reader.svelte';
  import UnlockGate from './components/UnlockGate.svelte';
  import { Store } from './lib/store.svelte.js';
  import { loadDraft, loadAllDrafts, clearDraft } from './lib/persist.js';
  import { decryptAndLoad } from './lib/load.js';

  const store = new Store();

  // A self-contained reader file embeds the plan as window.__LIFE_PACKAGE__.
  const embedded = typeof window !== 'undefined' ? window.__LIFE_PACKAGE__ : null;
  const readerMode = !!embedded?.reader;
  let gateEnvelope = $state(null);

  let drafts = $state([]);

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
    (async () => {
      const all = await loadAllDrafts();
      drafts = all
        .filter((d) => d.data)
        .map((d) => ({ key: d.key, savedAt: d.savedAt, title: d.data?.package?.title || 'Unnamed plan' }))
        .sort((a, b) => (b.savedAt || '') > (a.savedAt || '') ? 1 : -1);
    })();
  });

  async function unlockEmbedded(password) {
    const loaded = await decryptAndLoad(gateEnvelope, password);
    store.load(loaded);
    gateEnvelope = null;
  }

  function onLoaded(loaded) { store.load(loaded); window.scrollTo({ top: 0 }); }
  function close() { store.reset(); }

  // Start a brand-new plan and drop straight into edit mode with a "Start here"
  // guide in a "General" group so the user knows where to begin.
  function newPlan() {
    const id = crypto?.randomUUID?.() || 'plan_' + Math.random().toString(36).slice(2);
    const today = new Date().toISOString().slice(0, 10);
    // Unique default name, same pattern as guides/groups: "My inheritance plan",
    // "My inheritance plan (1)"… when earlier plans already use the name.
    const taken = new Set(drafts.map((d) => d.title));
    let title = 'My inheritance plan';
    let n = 1;
    while (taken.has(title)) title = `My inheritance plan (${n++})`;
    const startHereContent = `## Welcome to your inheritance plan

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
      schema: 'inheritance-package/v1',
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

  async function resumeDraft(key) {
    const d = await loadDraft(key);
    if (!d?.data) return;
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
    store.load({ data: d.data, attachmentUrls, blobs });
    store.startEditing();
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
{:else}
  <Landing {onLoaded} {newPlan} {drafts} {resumeDraft} {discardDraft} />
{/if}
