/*
  Reactive editable store for the whole package.

  - `data` is the raw, mutable, deeply-reactive source of truth.
  - `pkg` is a derived read-only InheritancePackage view (the Reader renders it).
  - In edit mode, any change to `data` is auto-saved to IndexedDB (debounced).
  Nothing leaves the device.
*/

import { InheritancePackage } from './package.js';
import { collectRoleIds, humanizeKey, migrateInternalTasks, normalizedRoles, slugifyTag } from './package.js';
import { saveDraft, saveDraftBlob, deleteDraftBlob, clearDraft, putFileHandle, loadDraft } from './persist.js';
import { generateMasterKey, wrapMasterKeyForSlot } from './slotcrypto.js';
import { buildContainer, buildPlanFileHtml, parseContainerFromHtml, readContainer } from './planfile.js';
import { fontsToKeep, triggerDownload } from './export.js';
import { clearViewPrefs } from './viewPrefs.js';

const FILE_WRITE_DEBOUNCE_MS = 2000;

// Hard ceiling on the plan file's total size (CHANGES.md Q5) — past this,
// `.zip` export no longer exists as an overflow escape hatch, so new
// attachments are refused outright instead of silently growing an unwieldy
// file. Estimate mirrors ExportSizeBanner's (+33% for base64 inflation).
const ATTACHMENT_CEILING_BYTES = 250 * 1024 * 1024;

const KINDS = ['people', 'locations', 'items', 'guides', 'folders', 'attachments'];
const PLAN_ARRAYS = [...KINDS, 'readiness_checks', 'readiness_runs', 'readiness_tasks'];
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

// Content fingerprint that ignores the auto-managed package "updated" date.
function stableKey(snap) {
  const p = snap?.package ? { ...snap.package, updated: undefined } : snap?.package;
  return JSON.stringify({ ...snap, package: p });
}

/** Self-healing check for a resumed draft's `hasAddedEntity` flag: a record
 *  saved by the now-fixed debounce-race bug (see #processChanges) could be
 *  permanently stuck at `hasAddedEntity: false` — the interrupted save never
 *  landed, so IndexedDB kept the pre-edit snapshot from persistOnOpen()
 *  forever, hiding the file-status bar even though the plan clearly has real
 *  content. Mirrors exactly what addPerson/addLocation/addItem/addGuide flip
 *  the flag for — the seeded owner + "Start here" guide don't count. */
export function hasRealContent(data) {
  if (!data) return false;
  return (data.people?.length || 0) > 1
    || (data.locations?.length || 0) > 0
    || (data.items?.length || 0) > 0
    || (data.guides?.length || 0) > 1;
}

// Read every property of a deeply-reactive tree WITHOUT cloning it, so the
// enclosing $effect subscribes to all of it. This is the cheap per-keystroke
// path — the expensive snapshot + stringify happens only once per debounce
// window, in #processChanges.
function touchAll(v) {
  if (v && typeof v === 'object') {
    for (const k in v) touchAll(v[k]);
  }
}

export class Store {
  data = $state(null);
  attachmentUrls = $state({});
  mode = $state('read'); // 'read' | 'edit'
  editable = $state(false); // becomes true once editing starts → autosave on
  savedAt = $state(null);

  // File-autosave (see planfile.js / FORMAT.md's Container Format v1). `revision`
  // increments on every real content change; `fileRevision` is the last one
  // actually written to the live file, so a reload can tell "is the file behind"
  // without trusting a clock. `fileName`/`hasAddedEntity` persist alongside
  // `data` in the IndexedDB draft record — see #processChanges below.
  revision = $state(0);
  hasAddedEntity = $state(false); // has the user added a real person/location/item/guide yet
  fileName = $state(null); // set once homed (live handle or a fallback download)
  fileRevision = $state(0);
  fileWriteFailed = $state(false);
  fileSavedAt = $state(null);

  // Iteration 2b: when a file-backed plan reconnects, the file itself is
  // authoritative (see `openFromFile`) — this is how many revisions the local
  // crash-scratch is ahead of what was just loaded from the file, if any.
  // 0 means there's nothing to offer.
  scratchAheadBy = $state(0);

  attachmentBlobs = new Map(); // id -> Blob (non-reactive; for export + persist)
  pkg = $derived(this.data ? new InheritancePackage(this.data, this.attachmentUrls) : null);

  #timer = null;
  #baseline = null; // last-seen content key (excluding the auto "updated" date)
  #inFlight = null; // the save currently being written, if any (see #processChanges)
  #persistedBlobs = new Map(); // id -> Blob already written to IndexedDB
  // buildContainer()'s per-attachment ciphertext/base64 cache (see planfile.js)
  // — kept alive across saves so an unchanged attachment costs nothing on the
  // next write. Reset whenever the plan/master key changes out from under it.
  #attachmentCache = new Map();
  #fileHandle = null; // FileSystemFileHandle — memory only, never persisted directly
  #fileTimer = null;

  // Multi-passphrase container encryption (see slotcrypto.js / FORMAT.md).
  // `slots` holds full slot objects (label/hint/salt/iv/wrappedKey — none of
  // it secret without the passphrase), so it's safe to keep reactively and
  // serialize into the scratch record. `#masterKeyRaw` is the one secret,
  // memory-only, cleared on `reset()`/`lockDraft()`.
  slots = $state([]);
  #masterKeyRaw = null;
  #lockedPlanId = null; // remembered across lockDraft() so unlocking knows which plan/file to re-decrypt
  locked = $state(false);

  get protected() {
    return this.slots.length > 0;
  }

  constructor() {
    // Auto-save on a real change while editing, and stamp the plan's "updated"
    // date automatically (never on mere open / no-op). The effect only walks
    // the tree (to subscribe) and debounces; the change detection and the save
    // run at most once per debounce window.
    $effect.root(() => {
      $effect(() => {
        if (!this.editable || !this.data) return;
        touchAll(this.data);
        if (this.#baseline === null) {
          // First run after editing starts: remember the opening state NOW —
          // debouncing this would swallow any edits made in the first window.
          this.#baseline = stableKey($state.snapshot(this.data));
          return;
        }
        this.#scheduleProcess();
      });
    });
  }

  load({
    data, attachmentUrls = {}, blobs = new Map(), persistedDraft = false, masterKeyRaw = null, slots = [],
    revision = 0, hasAddedEntity = false, fileHandle = null, fileName = null, fileRevision = 0
  }) {
    migrateInternalTasks(data);
    this.data = data;
    this.attachmentUrls = attachmentUrls;
    this.attachmentBlobs = blobs;
    // A resumed draft's blobs already live in IndexedDB — don't rewrite them on
    // the first save. Anything else (import, new plan) must be written once.
    this.#persistedBlobs = persistedDraft ? new Map(blobs) : new Map();
    this.#attachmentCache = new Map();
    this.#masterKeyRaw = masterKeyRaw;
    this.slots = slots;
    this.locked = false;
    this.mode = 'read';
    this.editable = false;
    this.savedAt = null;
    this.#baseline = null;
    this.revision = revision;
    this.hasAddedEntity = hasAddedEntity;
    this.#fileHandle = fileHandle;
    this.fileName = fileName;
    this.fileRevision = fileRevision;
    this.fileWriteFailed = false;
    this.fileSavedAt = null;
    clearTimeout(this.#fileTimer);
  }

  reset() {
    clearViewPrefs(this.data?.package?.id || 'current');
    this.data = null;
    this.attachmentUrls = {};
    this.attachmentBlobs = new Map();
    this.#persistedBlobs = new Map();
    this.#attachmentCache = new Map();
    this.#masterKeyRaw = null;
    this.slots = [];
    this.locked = false;
    this.#lockedPlanId = null;
    this.mode = 'read';
    this.editable = false;
    this.#baseline = null;
    this.revision = 0;
    this.hasAddedEntity = false;
    this.#fileHandle = null;
    this.fileName = null;
    this.fileRevision = 0;
    this.fileWriteFailed = false;
    this.fileSavedAt = null;
    clearTimeout(this.#fileTimer);
  }

  /** Turn on passphrase protection for this plan: a fresh random master key,
   *  wrapped into a first slot, then a full re-persist under the new scheme. */
  async protectPlan(passphrase, label, hint) {
    if (this.protected) return;
    const planId = this.data?.package?.id || 'current';
    const masterKeyRaw = generateMasterKey();
    const slot = await wrapMasterKeyForSlot({ masterKeyRaw, passphrase, label, hint, planId });
    this.#masterKeyRaw = masterKeyRaw;
    this.slots = [slot];
    // Any attachment blob already written to the plaintext blob store (from
    // before this plan was protected) must not survive protection — from now
    // on its bytes live only inside the encrypted container (see #syncBlobs,
    // which never runs once this.slots is non-empty), so a leftover plaintext
    // copy here would sit unencrypted at rest indefinitely.
    for (const id of this.#persistedBlobs.keys()) await deleteDraftBlob(planId, id);
    this.#persistedBlobs = new Map();
    // A fresh master key invalidates any stale 'encrypted' cache entries left
    // over from a prior protect/unprotect cycle on this same plan — without
    // this, buildContainer could reuse ciphertext encrypted under a key that
    // no longer exists (see planfile.js's cachedEncryptedEntry).
    this.#attachmentCache = new Map();
    this.#baseline = '';
    clearTimeout(this.#timer);
    await this.#processChanges();
  }

  /** Wrap the existing master key under a new passphrase-derived slot — any
   *  one of the resulting slots can still recover the same plan. */
  async addSlot(passphrase, label, hint) {
    if (!this.protected) return;
    const planId = this.data?.package?.id || 'current';
    const slot = await wrapMasterKeyForSlot({ masterKeyRaw: this.#masterKeyRaw, passphrase, label, hint, planId });
    this.slots = [...this.slots, slot];
    this.#baseline = '';
    clearTimeout(this.#timer);
    await this.#processChanges();
  }

  /** Remove one slot. Removing the last one turns protection off entirely —
   *  same effect disableProtection() used to have, folded in here since the
   *  UI no longer offers a separate "make passphrase-free" action. */
  async removeSlot(slotId) {
    const next = this.slots.filter((s) => s.id !== slotId);
    if (next.length === this.slots.length) return false;
    this.slots = next;
    if (!next.length) {
      this.#masterKeyRaw = null;
      this.#persistedBlobs = new Map();
    }
    this.#baseline = '';
    clearTimeout(this.#timer);
    await this.#processChanges();
    return true;
  }

  /** Re-key one slot (same id, new passphrase/label/hint) — every other slot
   *  is untouched. */
  async rekeySlot(slotId, newPassphrase, label, hint) {
    const idx = this.slots.findIndex((s) => s.id === slotId);
    if (idx < 0) return false;
    const planId = this.data?.package?.id || 'current';
    const slot = await wrapMasterKeyForSlot({ masterKeyRaw: this.#masterKeyRaw, passphrase: newPassphrase, label, hint, planId, slotId });
    const next = [...this.slots];
    next[idx] = slot;
    this.slots = next;
    this.#baseline = '';
    clearTimeout(this.#timer);
    await this.#processChanges();
    return true;
  }

  /** Flush any pending save, then drop the plan content and the master key
   *  from memory — but keep the file/draft connection (fileHandle/fileName/
   *  slots/planId) alive, so unlocking resumes the same plan instead of
   *  dropping back to the landing screen. */
  async lockDraft() {
    clearTimeout(this.#timer);
    await this.#processChanges();
    clearTimeout(this.#fileTimer);
    this.#lockedPlanId = this.data?.package?.id || 'current';
    clearViewPrefs(this.#lockedPlanId);
    this.data = null;
    this.attachmentUrls = {};
    this.attachmentBlobs = new Map();
    this.#persistedBlobs = new Map();
    this.#masterKeyRaw = null;
    this.mode = 'read';
    this.editable = false;
    this.#baseline = null;
    this.locked = true;
  }

  /** Read back the raw (still-encrypted) container to unlock after
   *  `lockDraft()` — the still-live file handle if there is one (re-reading
   *  the file fresh, in case it changed while locked), else the just-flushed
   *  IndexedDB scratch record. */
  async loadLockedContainer() {
    if (this.#fileHandle) {
      try {
        const text = await (await this.#fileHandle.getFile()).text();
        const container = parseContainerFromHtml(text);
        if (container) return container;
      } catch {
        /* fall through to the scratch copy */
      }
    }
    return (await loadDraft(this.#lockedPlanId || 'current')) || null;
  }

  /** Reassign the decrypted plan content after an `unlockContainer(...)` call
   *  against `loadLockedContainer()`'s result — mirrors `load()` but keeps
   *  the file/draft connection (revision, fileName, slots, …) untouched. */
  async resumeAfterUnlock({ data, attachmentUrls, blobs, masterKeyRaw }) {
    migrateInternalTasks(data);
    this.data = data;
    this.attachmentUrls = attachmentUrls;
    this.attachmentBlobs = blobs;
    this.#persistedBlobs = this.#fileHandle ? new Map() : new Map(blobs);
    this.#masterKeyRaw = masterKeyRaw;
    this.mode = 'edit';
    this.editable = true;
    this.locked = false;
  }

  ensureArrays() {
    if (!this.data) return;
    for (const k of PLAN_ARRAYS) if (!Array.isArray(this.data[k])) this.data[k] = [];
    if (!this.data.package) this.data.package = {};
    if (!Array.isArray(this.data.package.languages) || !this.data.package.languages.length) this.data.package.languages = ['en'];
    if (!this.data.package.default_language) this.data.package.default_language = this.data.package.languages[0];
    this.ensureRoles();
    this.ensureGuideGroups();
  }

  ensureRoles() {
    if (!this.data) return;
    this.data.roles = normalizedRoles(this.data);
  }

  ensureGuideGroups() {
    if (!this.data) return;
    if (!Array.isArray(this.data.guide_groups)) this.data.guide_groups = [];
    const known = new Set(this.data.guide_groups.map((g) => g.id));
    for (const g of this.data.guides || []) {
      if (g.group && !known.has(g.group)) {
        known.add(g.group);
        this.data.guide_groups.push({ id: g.group, name: humanizeKey(g.group), order: g.order });
      }
    }
  }

  startEditing() {
    this.ensureArrays();
    // Normalize the guide-nav order space on entry so every drag operates on a
    // clean, gap-free sequence. Imported plans (e.g. the sample) can carry
    // fractional / colliding orders that make a root guide tie with a group;
    // this removes those ties up front. Done before `editable` so it doesn't
    // count as an edit.
    this.#renumberBlocks(this.#navBlocks());
    this.mode = 'edit';
    this.editable = true;
  }
  stopEditing() { this.mode = 'read'; }
  startSettings() {
    this.ensureArrays();
    if (this.#baseline === null) this.#baseline = stableKey($state.snapshot(this.data));
    this.editable = true;
  }

  // 50ms, not something more generous like the old 600ms: a debounce this
  // short still coalesces genuinely-rapid changes (each keystroke resets the
  // timer), but empirically, anything much longer than this reopens the
  // exact race flushPendingChanges() exists to close — visibilitychange
  // firing on refresh doesn't buy the in-flight async save any extra time to
  // finish before the page is torn down (see App.svelte), so the real
  // defense is finishing the write well before a person could plausibly
  // reload at all. Verified via repeated fast-refresh tests down to a
  // genuinely instant (0ms-gap, scripted) reload.
  #scheduleProcess() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#processChanges(), 50);
  }

  /** Skip the 600ms debounce and write right now — called when the tab is
   *  about to go away (visibilitychange/pagehide, see App.svelte) so a fast
   *  refresh right after an edit can't lose that edit or leave
   *  hasAddedEntity/the file-status bar out of sync with what's really on
   *  the page. If a save is already in flight (the debounce timer having
   *  just fired on its own), join it instead of re-checking the baseline —
   *  that check would otherwise pass (see #processChanges) before the
   *  in-flight write has actually reached IndexedDB, making the flush a
   *  no-op right as the real write is the thing that needs to finish before
   *  the page goes away. */
  flushPendingChanges() {
    clearTimeout(this.#timer);
    return this.#inFlight || this.#processChanges();
  }

  async #processChanges() {
    if (!this.editable || !this.data) return;
    const snap = $state.snapshot(this.data);
    const key = stableKey(snap);
    if (key === this.#baseline) {
      // A re-uploaded file can change without changing the JSON. Protected
      // plans embed every blob straight into the ciphertext (see below), so
      // there's no separate per-blob store to sync — the new bytes are
      // picked up lazily on the next real edit, same as the file-autosave
      // path already does for unprotected plans.
      if (!this.slots.length) await this.#syncBlobs();
      return;
    }
    const rev = this.revision + 1;
    const stamp = today();
    if (this.data.package) this.data.package.updated = stamp;
    if (snap.package) snap.package.updated = stamp; // save what we stamped, without re-snapshotting
    const at = new Date().toISOString();
    const planKey = snap.package?.id || 'current';
    // `baseline`/`revision` only advance once the write actually succeeds —
    // flipping them first (before the await) would let a save that gets cut
    // off by page teardown look like it happened, and would make a
    // concurrent flushPendingChanges() bail out as a false no-op right when
    // it's needed most.
    const task = (async () => {
      let record;
      if (this.slots.length) {
        record = await buildContainer({
          planId: planKey, revision: rev, data: snap, blobs: this.attachmentBlobs,
          protection: { masterKeyRaw: this.#masterKeyRaw, slots: $state.snapshot(this.slots) },
          attachmentCache: this.#attachmentCache
        });
        record.savedAt = at;
        record.hasAddedEntity = this.hasAddedEntity;
      } else {
        record = { data: snap, savedAt: at, revision: rev, hasAddedEntity: this.hasAddedEntity };
      }
      const ok = await saveDraft(record, planKey);
      if (!this.slots.length) await this.#syncBlobs();
      if (ok) {
        this.#baseline = key;
        this.revision = rev;
        this.savedAt = at;
        this.#scheduleFileWrite();
      }
    })();
    this.#inFlight = task;
    try {
      await task;
    } finally {
      if (this.#inFlight === task) this.#inFlight = null;
    }
  }

  /** Persist an immediate scratch-draft snapshot the moment a plan is opened
   *  — before any edit — so a plan someone just opened (import, new plan,
   *  one-time .html import) doesn't vanish from the launcher's "your plans"
   *  list if they navigate away without touching anything. #processChanges
   *  above only ever saves once there's a real change from the opening
   *  baseline; this deliberately bypasses that gate, and — since nothing has
   *  actually changed yet — doesn't touch revision or the "updated" stamp.
   *  Skipped for a live file-backed open: the file itself is already the
   *  immediately-remembered copy (see openFromFile's own putFileHandle call),
   *  so this would just be a redundant IndexedDB copy of what's on disk. */
  async persistOnOpen() {
    if (!this.data || this.#fileHandle) return;
    const snap = $state.snapshot(this.data);
    const at = new Date().toISOString();
    const planKey = snap.package?.id || 'current';
    let record;
    if (this.slots.length) {
      record = await buildContainer({
        planId: planKey, revision: this.revision, data: snap, blobs: this.attachmentBlobs,
        protection: { masterKeyRaw: this.#masterKeyRaw, slots: $state.snapshot(this.slots) },
        attachmentCache: this.#attachmentCache
      });
      record.savedAt = at;
      record.hasAddedEntity = this.hasAddedEntity;
    } else {
      record = { data: snap, savedAt: at, revision: this.revision, hasAddedEntity: this.hasAddedEntity };
    }
    const ok = await saveDraft(record, planKey);
    if (ok) this.savedAt = at;
    if (!this.slots.length) await this.#syncBlobs();
  }

  // ---- File autosave (Container Format v1 — see planfile.js/FORMAT.md) ----

  #scheduleFileWrite() {
    if (!this.#fileHandle) return;
    clearTimeout(this.#fileTimer);
    this.#fileTimer = setTimeout(() => this.#writeFileNow(), FILE_WRITE_DEBOUNCE_MS);
  }

  async #writeFileNow() {
    if (!this.#fileHandle || !this.data) return;
    const snap = $state.snapshot(this.data);
    const planId = snap.package?.id || 'current';
    const rev = this.revision;
    try {
      const container = await buildContainer({
        planId, revision: rev, data: snap, blobs: this.attachmentBlobs,
        protection: this.slots.length ? { masterKeyRaw: this.#masterKeyRaw, slots: $state.snapshot(this.slots) } : null,
        attachmentCache: this.#attachmentCache
      });
      const html = await buildPlanFileHtml(container, fontsToKeep(snap));
      const writable = await this.#fileHandle.createWritable();
      await writable.write(html);
      await writable.close();
      this.fileRevision = rev;
      this.fileSavedAt = new Date().toISOString();
      this.fileWriteFailed = false;
      await putFileHandle(planId, this.fileName, this.#fileHandle, rev, this.slots.length > 0);
    } catch {
      this.fileWriteFailed = true;
    }
  }

  /** Manual retry after a failed file write (see FileSaveBanner) — the next
   *  edit would also retry, but a stuck failure with no further edits needs
   *  its own way out. */
  async retryFileWrite() {
    if (!this.#fileHandle) return;
    clearTimeout(this.#fileTimer);
    await this.#writeFileNow();
  }

  /** How many real edits haven't made it into the live file yet. */
  get pendingFileChanges() {
    return Math.max(0, this.revision - this.fileRevision);
  }

  get isFileBehind() {
    return !!this.#fileHandle && this.revision > this.fileRevision;
  }

  /** True for the no-File-System-Access fallback: homed via download, but new
   *  changes since then need a fresh manual download (see FileSaveBanner). */
  get needsManualFileUpdate() {
    return !this.#fileHandle && !!this.fileName && this.revision > this.fileRevision;
  }

  /**
   * The user just picked (or the app silently reconnected to) a real file
   * handle for this plan — the "homing" moment for File System Access
   * browsers. Writes immediately when there's anything not yet on disk
   * (always true the first time a plan is homed).
   */
  async connectFileHandle(handle, name, { force = false } = {}) {
    // A debounced draft save may still be pending (or mid-flight) — settle it
    // first so `this.revision` below reflects what's actually about to be
    // written, not a stale value the in-flight save is about to bump out from
    // under this call (see downloadFileNow for the same reasoning).
    await this.flushPendingChanges();
    this.#fileHandle = handle;
    this.fileName = name;
    const planId = this.data?.package?.id || 'current';
    await putFileHandle(planId, name, handle, this.fileRevision, this.slots.length > 0);
    if (force || this.revision > this.fileRevision) {
      clearTimeout(this.#fileTimer);
      await this.#writeFileNow();
    }
  }

  /** Fallback homing/update for browsers without File System Access: builds
   *  the same container-v1 html and triggers a download instead of writing a
   *  live handle. Used both for the first "choose location" and every later
   *  "Update your file (n changes)" click — there's no live handle to keep
   *  writing into, so `needsManualFileUpdate` drives an explicit button. */
  async downloadFileNow(name = this.fileName) {
    if (!this.data || !name) return;
    // Same reasoning as connectFileHandle: settle any pending/in-flight draft
    // save first, so `rev` below can't go stale out from under this call —
    // captured too early, this.revision could still bump right after,
    // permanently (and wrongly) marking the just-downloaded file "behind".
    await this.flushPendingChanges();
    const snap = $state.snapshot(this.data);
    const planId = snap.package?.id || 'current';
    const rev = this.revision;
    const container = await buildContainer({
      planId, revision: rev, data: snap, blobs: this.attachmentBlobs,
      protection: this.slots.length ? { masterKeyRaw: this.#masterKeyRaw, slots: $state.snapshot(this.slots) } : null,
      attachmentCache: this.#attachmentCache
    });
    const html = await buildPlanFileHtml(container, fontsToKeep(snap));
    triggerDownload(new Blob([html], { type: 'text/html' }), name);
    this.fileName = name;
    this.fileRevision = rev;
    this.fileSavedAt = new Date().toISOString();
    await putFileHandle(planId, name, null, rev, this.slots.length > 0);
  }

  /**
   * Iteration 2b's source-of-truth flip: reconnecting to a file-backed plan
   * loads the file's own content (already read + parsed by the caller —
   * see App.svelte's `continueFileBackedPlan`/`locateFileForPlan`) instead of
   * IndexedDB. IndexedDB then only matters as a possible crash-recovery copy,
   * checked right after via `#checkScratchNewer`.
   */
  async openFromFile({ data, attachmentUrls, blobs }, revision, handle, name, { masterKeyRaw = null, slots = [] } = {}) {
    this.load({
      data, attachmentUrls, blobs, persistedDraft: false, masterKeyRaw, slots,
      revision, hasAddedEntity: true, fileHandle: handle, fileName: name, fileRevision: revision
    });
    this.startEditing();
    // Persist the handle used to open this plan — not just the one written on
    // the next edit — so a freshly-picked handle from "Locate it" sticks even
    // if the user closes the tab without touching anything, and so
    // `lastOpenedAt` reflects this open, not just the last write.
    await putFileHandle(data?.package?.id || 'current', name, handle, revision, slots.length > 0);
    await this.#checkScratchNewer(data?.package?.id || 'current');
  }

  async #checkScratchNewer(planId) {
    const d = await loadDraft(planId);
    this.scratchAheadBy = (d?.data && typeof d.revision === 'number' && d.revision > this.revision)
      ? d.revision - this.revision
      : 0;
  }

  /** "Restore backup" (see FileSaveBanner): the local scratch has changes the
   *  file doesn't. Reassigning `data` (rather than hand-rolling revision/
   *  baseline bookkeeping) lets the existing autosave effect treat this like
   *  any other edit — it bumps `revision`, re-persists the scratch, and
   *  schedules the normal debounced file write. */
  async restoreScratchBackup() {
    const planId = this.data?.package?.id || 'current';
    const d = await loadDraft(planId);
    if (!d?.data) { this.scratchAheadBy = 0; return; }
    let attachmentUrls = {};
    let blobs = new Map();
    let plainData;
    if (this.slots.length) {
      // Protected scratch record is a container (v1 or v2 — see planfile.js's
      // readContainer): `d.data` is ciphertext, decrypted with the
      // already-in-memory master key (this is only reachable mid-session on
      // an already-unlocked protected plan).
      const result = await readContainer({ container: d, masterKeyRaw: this.#masterKeyRaw });
      plainData = result.data;
      attachmentUrls = result.attachmentUrls;
      blobs = result.blobs;
    } else {
      plainData = d.data;
      for (const a of d.attachments || []) {
        if (a.blob) {
          const blob = a.blob.type ? a.blob : a.blob.slice(0, a.blob.size);
          blobs.set(a.id, blob);
          attachmentUrls[a.id] = URL.createObjectURL(blob);
        }
      }
    }
    migrateInternalTasks(plainData);
    this.data = plainData;
    this.attachmentUrls = attachmentUrls;
    this.attachmentBlobs = blobs;
    this.#persistedBlobs = this.slots.length ? new Map() : new Map(blobs); // already in the scratch store
    this.scratchAheadBy = 0;
  }

  /** "Use file instead" (see FileSaveBanner): discard the scratch, keep the
   *  file's content as loaded. */
  async useFileInstead() {
    const planId = this.data?.package?.id || 'current';
    await clearDraft(planId);
    this.scratchAheadBy = 0;
  }

  // Write only new/replaced attachment blobs; delete removed ones. Keeps every
  // keystroke from rewriting megabytes of files into IndexedDB. Only called
  // for unprotected plans — a protected plan's blobs travel embedded in the
  // ciphertext record instead (see #processChanges).
  async #syncBlobs() {
    const planKey = this.data?.package?.id || 'current';
    for (const [id, blob] of this.attachmentBlobs) {
      if (this.#persistedBlobs.get(id) !== blob) {
        if (await saveDraftBlob(planKey, id, blob)) this.#persistedBlobs.set(id, blob);
      }
    }
    for (const id of [...this.#persistedBlobs.keys()]) {
      if (!this.attachmentBlobs.has(id)) {
        await deleteDraftBlob(planKey, id);
        this.#persistedBlobs.delete(id);
      }
    }
  }

  async discardDraft() {
    await clearDraft(this.data?.package?.id || 'current');
    this.#persistedBlobs = new Map();
    this.savedAt = null;
  }

  // ---- lookups ----
  /** The live (reactive) raw object for an id, for forms to bind to. */
  rawById(id) {
    if (!this.data) return null;
    for (const k of KINDS) { const o = this.data[k]?.find((x) => x.id === id); if (o) return o; }
    const check = this.data.readiness_checks?.find((x) => x.id === id);
    if (check) return check;
    const task = this.data.readiness_tasks?.find((x) => x.id === id);
    if (task) return task;
    const role = this.data.roles?.find((x) => x.id === id);
    if (role) return role;
    return null;
  }

  genId(prefix) {
    const exists = (id) =>
      KINDS.some((k) => this.data[k]?.some((o) => o.id === id)) ||
      this.data.readiness_checks?.some((o) => o.id === id) ||
      this.data.readiness_runs?.some((o) => o.id === id) ||
      this.data.readiness_tasks?.some((o) => o.id === id) ||
      this.data.guide_groups?.some((o) => o.id === id) ||
      this.data.roles?.some((o) => o.id === id);
    let id;
    do { id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`; } while (exists(id));
    return id;
  }

  // ---- CRUD ----
  addPerson() {
    this.ensureArrays();
    const id = this.genId('person');
    this.data.people.push({ id, name: '', roles: [] });
    this.hasAddedEntity = true;
    return id;
  }

  addLocation(parentId = null) {
    this.ensureArrays();
    const id = this.genId('loc');
    const order = this.#locSiblings(parentId).reduce((m, l) => Math.max(m, l.order ?? -1), -1) + 1;
    const loc = { id, name: '', order };
    if (parentId) loc.parent_id = parentId;
    this.data.locations.push(loc);
    this.hasAddedEntity = true;
    return id;
  }

  #locSiblings(parentId) {
    const pid = parentId || null;
    return (this.data.locations || []).filter((l) => (l.parent_id || null) === pid);
  }

  /**
   * Move a location to a new parent / position (drag-and-drop). `parentId` is
   * the new parent (null = top level), `beforeId` the sibling it lands before
   * (null = end). Renumbers the destination siblings. Guards against cycles.
   */
  moveLocation(id, parentId = null, beforeId = null) {
    this.ensureArrays();
    const loc = this.data.locations.find((l) => l.id === id);
    if (!loc) return;
    const target = parentId || null;
    if (target === id) return;
    // No dropping a location inside its own descendant.
    let cur = target;
    const byId = new Map(this.data.locations.map((l) => [l.id, l]));
    while (cur) { if (cur === id) return; cur = byId.get(cur)?.parent_id || null; }

    if (target) loc.parent_id = target; else delete loc.parent_id;

    const ids = this.#locSiblings(target).map((l) => l.id).filter((x) => x !== id);
    const at = beforeId && beforeId !== id ? ids.indexOf(beforeId) : -1;
    if (at >= 0) ids.splice(at, 0, id); else ids.push(id);
    ids.forEach((lid, i) => { const l = byId.get(lid); if (l) l.order = i; });
  }

  addItem() {
    this.ensureArrays();
    const id = this.genId('item');
    this.data.items.push({ id, name: '' });
    this.hasAddedEntity = true;
    return id;
  }

  addGuide() {
    this.ensureArrays();
    const id = this.genId('guide');
    const lang = this.data.package?.default_language || this.data.package?.languages?.[0] || 'en';
    // Append after the last nav block (root guide or group), then renumber, so
    // the new guide's order can't collide with a group's order.
    const order = this.#navBlocks().reduce((m, b) => Math.max(m, b.order ?? -1), -1) + 1;
    const titles = new Set(this.data.guides.map((g) => g.title));
    let title = 'New Guide';
    let n = 1;
    while (titles.has(title)) title = `New Guide (${n++})`;
    this.data.guides.push({ id, title, content: { [lang]: '' }, order, updated: today() });
    this.#renumberBlocks(this.#navBlocks());
    this.hasAddedEntity = true;
    return id;
  }

  // ---- Guide nav groups + manual ordering (drag-and-drop) ----
  addGuideGroup(name) {
    this.ensureArrays();
    if (!Array.isArray(this.data.guide_groups)) this.data.guide_groups = [];
    const id = this.genId('grp');
    const order = this.#navBlocks().reduce((m, b) => Math.max(m, b.order ?? -1), -1) + 1;
    // Auto-name uniquely, same pattern as guides: "New group", "New group (1)"…
    if (!name) {
      const taken = new Set(this.data.guide_groups.map((g) => g.name));
      name = 'New group';
      let n = 1;
      while (taken.has(name)) name = `New group (${n++})`;
    }
    this.data.guide_groups.push({ id, name, order });
    this.#renumberBlocks(this.#navBlocks());
    return id;
  }

  /** Toggle a guide's draft flag. Draft guides are kept in the working plan but
   *  excluded from any heir-facing export (and any group they'd leave empty). */
  toggleGuideDraft(id) {
    this.ensureArrays();
    const g = this.data.guides.find((x) => x.id === id);
    if (!g) return;
    if (g.draft) delete g.draft; else g.draft = true;
  }

  /** Editor writes go through the store (which owns the data) so the content
   *  editor never mutates a prop it doesn't own. */
  setGuideContent(id, lang, value) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (!g.content) g.content = {};
    g.content[lang] = value;
  }
  addGuideRef(id, key, refId) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g || !key) return;
    if (!g.references) g.references = {};
    if (!g.references[key]) g.references[key] = [];
    if (!g.references[key].includes(refId)) g.references[key].push(refId);
  }

  #defaultLang() { return this.data?.package?.default_language || this.data?.package?.languages?.[0] || null; }

  /** Set a guide title for a language. The default language is the primary
   *  `title`; other languages are stored as overrides in `title_i18n`. */
  setGuideTitle(id, lang, value) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (!lang || lang === this.#defaultLang()) { g.title = value; return; }
    if (!g.title_i18n) g.title_i18n = {};
    g.title_i18n[lang] = value;
  }

  /** Guarantee the shape editors expect (content/references maps), so a
   *  guide imported without them doesn't need each editor to init it itself. */
  ensureGuideShape(id) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (!g.content) g.content = {};
    if (!g.references) g.references = {};
  }
  setGuideImportance(id, value) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (value) g.importance = value; else delete g.importance;
  }
  /** Stamp "updated" today — callers only invoke this on a real change, not on
   *  mere open, since they diff against a baseline first. */
  touchGuide(id) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    const t = today();
    if (g.updated !== t) g.updated = t;
  }

  /** Set a guide-group name for a language (primary `name` / `name_i18n`). */
  setGroupName(id, lang, value) {
    const grp = this.data?.guide_groups?.find((x) => x.id === id);
    if (!grp) return;
    if (!lang || lang === this.#defaultLang()) { grp.name = value; return; }
    if (!grp.name_i18n) grp.name_i18n = {};
    grp.name_i18n[lang] = value;
  }

  #navGuides() {
    return this.data.guides || [];
  }

  #groupDef(id) {
    this.ensureGuideGroups();
    return this.data.guide_groups.find((g) => g.id === id) || null;
  }

  #navBlocks() {
    this.ensureGuideGroups();
    const navGuides = this.#navGuides();
    const groups = new Map();
    for (const def of this.data.guide_groups || []) groups.set(def.id, { kind: 'group', id: def.id, def, guides: [], order: def.order ?? Infinity, explicit: def.order != null });
    const blocks = [];
    for (const g of navGuides) {
      if (g.group) {
        const block = groups.get(g.group) || { kind: 'group', id: g.group, def: null, guides: [], order: Infinity, explicit: false };
        block.guides.push(g);
        // Explicit group order wins; member-min is only the fallback for
        // implied groups. Imported plans number guides per group, which would
        // otherwise collapse every group to 0 — and renumbering would then
        // PERSIST that shuffled order into the plan.
        if (!block.explicit) block.order = Math.min(block.order ?? Infinity, g.order ?? Infinity);
        groups.set(g.group, block);
      } else {
        blocks.push({ kind: 'guide', id: g.id, guide: g, order: g.order ?? Infinity });
      }
    }
    for (const block of groups.values()) blocks.push(block);
    blocks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.kind + a.id).localeCompare(b.kind + b.id));
    for (const block of blocks) if (block.kind === 'group') block.guides.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    return blocks;
  }

  #renumberBlocks(blocks) {
    let order = 0;
    for (const block of blocks) {
      if (block.kind === 'group') {
        const def = this.#groupDef(block.id);
        if (def) def.order = order;
        for (const guide of block.guides) guide.order = order++;
        if (!block.guides.length) order++;
      } else {
        block.guide.order = order++;
      }
    }
  }

  /**
   * Move a guide to a new position / group. `group` is the destination group
   * (null = top level). `beforeId` is the guide it should land in front of
   * (null = end of that destination).
   *
   * Works on the ordered block list (root guides + groups) read while orders
   * are still consistent, then renumbers once — the same safe pattern as
   * `moveGuideGroup`. Never reorder from half-written `order` values: a group's
   * block position depends on both its own `order` and its guides', so a
   * partial update creates ties that would snap the guide back behind a group.
   */
  moveGuide(id, group = null, beforeId = null) {
    this.ensureArrays();
    const moved = this.#navGuides().find((g) => g.id === id);
    if (!moved) return;
    const dest = group || null;
    if (beforeId === id) beforeId = null;

    const blocks = this.#navBlocks();

    // 1. Detach the guide from wherever it currently sits.
    for (const b of blocks) if (b.kind === 'group') b.guides = b.guides.filter((g) => g.id !== id);
    const rootAt = blocks.findIndex((b) => b.kind === 'guide' && b.id === id);
    if (rootAt >= 0) blocks.splice(rootAt, 1);

    // 2. Update group membership.
    if (dest) moved.group = dest; else delete moved.group;

    // 3. Re-insert at the destination.
    if (dest) {
      const target = blocks.find((b) => b.kind === 'group' && b.id === dest);
      if (target) {
        const at = beforeId ? target.guides.findIndex((g) => g.id === beforeId) : -1;
        if (at >= 0) target.guides.splice(at, 0, moved); else target.guides.push(moved);
      }
    } else {
      // Top level: land before the block that owns `beforeId` — a root guide, or
      // the group that contains it — else at the end of the list.
      const at = beforeId
        ? blocks.findIndex((b) =>
            (b.kind === 'guide' && b.id === beforeId) ||
            (b.kind === 'group' && (b.id === beforeId || b.guides.some((g) => g.id === beforeId))))
        : -1;
      const block = { kind: 'guide', id, guide: moved };
      if (at >= 0) blocks.splice(at, 0, block); else blocks.push(block);
    }

    this.#renumberBlocks(blocks);
  }

  /** Delete a guide group; its guides move to the top level, last in the list. */
  deleteGuideGroup(id) {
    this.ensureArrays();
    const orphans = (this.data.guides || []).filter((g) => g.group === id);
    for (const g of orphans) delete g.group;
    const i = this.data.guide_groups.findIndex((g) => g.id === id);
    if (i >= 0) this.data.guide_groups.splice(i, 1);
    // Renumber so the freed guides sit at the end of the top level.
    const blocks = this.#navBlocks().filter((b) => !(b.kind === 'group' && b.id === id));
    const moved = orphans
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      .map((g) => ({ kind: 'guide', id: g.id, guide: g }));
    this.#renumberBlocks([...blocks.filter((b) => !(b.kind === 'guide' && orphans.some((o) => o.id === b.id))), ...moved]);
  }

  moveGuideGroup(id, beforeKey = null) {
    this.ensureArrays();
    const blocks = this.#navBlocks();
    const index = blocks.findIndex((b) => b.kind === 'group' && b.id === id);
    if (index < 0) return;
    const [moved] = blocks.splice(index, 1);
    const at = beforeKey ? blocks.findIndex((b) => `${b.kind}:${b.id}` === beforeKey) : -1;
    if (at >= 0) blocks.splice(at, 0, moved); else blocks.push(moved);
    this.#renumberBlocks(blocks);
  }

  addFolder() {
    this.ensureArrays();
    const id = this.genId('folder');
    this.data.folders.push({ id, name: 'New folder' });
    return id;
  }

  async addAttachmentFile(file) {
    this.ensureArrays();
    let existingBytes = 0;
    for (const a of this.data.attachments || []) {
      existingBytes += this.attachmentBlobs.get(a.id)?.size || 0;
    }
    const estimatedTotal = (existingBytes + (file.size || 0)) * (4 / 3);
    if (estimatedTotal > ATTACHMENT_CEILING_BYTES) {
      throw new Error(`This file would push the plan file past ~${Math.round(ATTACHMENT_CEILING_BYTES / (1024 * 1024))}MB, which can be too large to open reliably. Keep photos and videos small, or split this material into a separate plan.`);
    }
    const id = this.genId('att');
    const original = file.name || 'file';
    const dot = original.lastIndexOf('.');
    const display = dot > 0 ? original.slice(0, dot) : original;
    const safe = original.replace(/[^\w.\-]+/g, '_');
    const path = `attachments/${id.replace(/^att_/, '')}_${safe}`;
    this.attachmentBlobs.set(id, file);
    this.attachmentUrls = { ...this.attachmentUrls, [id]: URL.createObjectURL(file) };
    this.data.attachments.push({ id, filename: display || safe, original_filename: original, path, mime: file.type || '' });
    return id;
  }

  #addTagTo(collection, ids, tag) {
    const t = slugifyTag(tag);
    if (!t) return;
    for (const id of ids) {
      const x = collection.find((e) => e.id === id);
      if (!x) continue;
      if (!Array.isArray(x.tags)) x.tags = [];
      if (!x.tags.includes(t)) x.tags.push(t);
    }
  }

  /** Add a tag to many files at once (bulk tagging from the Files view). */
  addTagToAttachments(ids, tag) {
    this.ensureArrays();
    this.#addTagTo(this.data.attachments, ids, tag);
  }

  /** Add a tag to many items at once (bulk tagging from the Items view). */
  addTagToItems(ids, tag) {
    this.ensureArrays();
    this.#addTagTo(this.data.items, ids, tag);
  }

  addLanguage(code) {
    this.ensureArrays();
    const lang = String(code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!lang) return null;
    if (!this.data.package.languages.includes(lang)) this.data.package.languages.push(lang);
    if (!this.data.package.default_language) this.data.package.default_language = lang;
    for (const guide of this.data.guides || []) {
      if (!guide.content) guide.content = {};
      if (!(lang in guide.content)) guide.content[lang] = '';
    }
    return lang;
  }

  deleteLanguage(lang) {
    this.ensureArrays();
    const languages = this.data.package.languages || [];
    if (languages.length <= 1) return false;
    const i = languages.indexOf(lang);
    if (i < 0) return false;
    languages.splice(i, 1);
    for (const guide of this.data.guides || []) if (guide.content) delete guide.content[lang];
    if (this.data.package.default_language === lang) this.data.package.default_language = languages[0] || 'en';
    return true;
  }

  addRole() {
    this.ensureArrays();
    let slug = 'role';
    const exists = (id) => collectRoleIds(this.data).includes(id);
    let i = 2;
    while (exists(slug)) slug = `role_${i++}`;
    this.data.roles.push({ id: slug, name: '' });
    return slug;
  }

  deleteRole(id) {
    this.ensureArrays();
    const i = this.data.roles.findIndex((r) => r.id === id);
    if (i >= 0) this.data.roles.splice(i, 1);
    for (const p of this.data.people || []) this.#rm(p.roles, id);
    for (const g of this.data.guides || []) this.#rm(g.audience_roles, id);
    for (const c of this.data.readiness_checks || []) this.#rm(c.role_ids, id);
  }

  // ---- Readiness checks + dry runs ----
  addReadinessCheck() {
    this.ensureArrays();
    const id = this.genId('check');
    const check = {
      id,
      title: '',
      importance: 'medium',
      question: '',
      expected: '',
      person_ids: [],
      role_ids: [],
      related_person_ids: [],
      related_item_ids: [],
      related_location_ids: [],
      related_guide_ids: [],
      related_attachment_ids: [],
      created: today()
    };
    this.data.readiness_checks.push(check);
    return id;
  }

  deleteReadinessCheck(id) {
    this.ensureArrays();
    const i = this.data.readiness_checks.findIndex((c) => c.id === id);
    if (i >= 0) this.data.readiness_checks.splice(i, 1);
    for (const run of this.data.readiness_runs || []) {
      if (!Array.isArray(run.results)) continue;
      for (let j = run.results.length - 1; j >= 0; j--) if (run.results[j].check_id === id) run.results.splice(j, 1);
    }
  }

  startReadinessRun(personId = null) {
    this.ensureArrays();
    if (this.#baseline === null) this.#baseline = stableKey($state.snapshot(this.data));
    this.editable = true;
    const id = this.genId('run');
    const started = nowIso();
    this.data.readiness_runs.push({ id, person_id: personId || null, date: today(), started_at: started, results: [] });
    return id;
  }

  submitReadinessRun(runId) {
    this.ensureArrays();
    const run = this.data.readiness_runs.find((r) => r.id === runId);
    if (!run) return;
    const submitted = nowIso();
    run.submitted_at = submitted;
    if (run.started_at) {
      const start = Date.parse(run.started_at);
      const end = Date.parse(submitted);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) run.duration_ms = end - start;
    }
  }

  setReadinessResult(runId, checkId, patch) {
    this.ensureArrays();
    const run = this.data.readiness_runs.find((r) => r.id === runId);
    if (!run) return;
    if (!Array.isArray(run.results)) run.results = [];
    let result = run.results.find((r) => r.check_id === checkId);
    if (!result) {
      result = { check_id: checkId, status: 'not_sure', notes: '' };
      run.results.push(result);
    }
    Object.assign(result, patch);
  }

  clearReadinessRunNotes(runId) {
    this.ensureArrays();
    const run = this.data.readiness_runs.find((r) => r.id === runId);
    if (!run?.results) return;
    for (const result of run.results) delete result.notes;
  }

  deleteReadinessResult(runId, checkId) {
    this.ensureArrays();
    const run = this.data.readiness_runs.find((r) => r.id === runId);
    if (!run?.results) return;
    const i = run.results.findIndex((r) => r.check_id === checkId);
    if (i >= 0) run.results.splice(i, 1);
  }

  deleteReadinessRun(runId) {
    this.ensureArrays();
    const i = this.data.readiness_runs.findIndex((r) => r.id === runId);
    if (i >= 0) this.data.readiness_runs.splice(i, 1);
  }

  discardReadinessRun(runId, { keepStatuses = true } = {}) {
    this.ensureArrays();
    const run = this.data.readiness_runs.find((r) => r.id === runId);
    if (!run) return;
    if (keepStatuses) {
      for (const result of run.results || []) delete result.notes;
      return;
    }
    const i = this.data.readiness_runs.findIndex((r) => r.id === runId);
    if (i >= 0) this.data.readiness_runs.splice(i, 1);
  }

  addTagToReadinessChecks(ids, tag) {
    this.ensureArrays();
    this.#addTagTo(this.data.readiness_checks, ids, tag);
  }

  // ---- Tasks (internal builder checklist — never shown to an heir) ----
  addReadinessTask() {
    this.ensureArrays();
    const id = this.genId('task');
    const task = {
      id, title: '', description: '', status: '',
      person_ids: [], location_ids: [], tags: [], created: today()
    };
    this.data.readiness_tasks.push(task);
    return id;
  }

  deleteReadinessTask(id) {
    this.ensureArrays();
    const i = this.data.readiness_tasks.findIndex((t) => t.id === id);
    if (i >= 0) this.data.readiness_tasks.splice(i, 1);
  }

  addTagToReadinessTasks(ids, tag) {
    this.ensureArrays();
    this.#addTagTo(this.data.readiness_tasks, ids, tag);
  }

  /**
   * Reorder a task in the flat "Manual" sort (drag-and-drop) — deliberately
   * disconnected from importance, matching Todoist's model where Manual is
   * its own sort you can freely interleave priorities in, rather than a
   * per-priority tweak. Completed tasks are excluded: they're hidden from
   * the list by default, so only what's actually draggable gets renumbered.
   * `beforeId` null appends to the end.
   */
  moveTask(id, beforeId = null) {
    this.ensureArrays();
    const task = this.data.readiness_tasks.find((t) => t.id === id);
    if (!task || id === beforeId) return;
    // Sort by current manual order first, so splicing the dragged task into
    // its new spot preserves everyone else's existing arrangement.
    const siblings = this.data.readiness_tasks
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    const ids = siblings.map((t) => t.id).filter((x) => x !== id);
    const at = beforeId && beforeId !== id ? ids.indexOf(beforeId) : -1;
    if (at >= 0) ids.splice(at, 0, id); else ids.push(id);
    const byId = new Map(siblings.map((t) => [t.id, t]));
    ids.forEach((tid, i) => { const t = byId.get(tid); if (t) t.order = i; });
  }

  #rm(arr, id) {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === id) arr.splice(i, 1);
  }

  // Find an entity (any kind, incl. roles) + its display name, for clean deletes.
  #findEntity(id) {
    const map = { people: 'person', locations: 'location', items: 'item', guides: 'guide', folders: 'folder', attachments: 'attachment' };
    for (const k of KINDS) { const o = this.data[k]?.find((x) => x.id === id); if (o) return { obj: o, kind: map[k] }; }
    const c = this.data.readiness_checks?.find((x) => x.id === id);
    if (c) return { obj: c, kind: 'readiness' };
    const t = this.data.readiness_tasks?.find((x) => x.id === id);
    if (t) return { obj: t, kind: 'task' };
    const r = this.data.roles?.find((x) => x.id === id);
    return r ? { obj: r, kind: 'role' } : null;
  }
  #nameOf(obj, kind) {
    if (kind === 'person') return obj.nickname || obj.name || obj.id;
    if (kind === 'attachment') return this.#attachmentNameWithExt(obj);
    if (kind === 'role') return obj.name || obj.id;
    if (kind === 'readiness') return obj.title || obj.id;
    if (kind === 'task') return obj.title || obj.id;
    return obj.name || obj.title || obj.id;
  }
  #attachmentNameWithExt(obj, defaultExt = '') {
    const name = obj.filename || obj.id;
    if (/\.[a-z0-9]+$/i.test(name)) return name;
    const blob = this.attachmentBlobs.get(obj.id);
    const ext =
      this.#extFromName(obj.original_filename) ||
      this.#extFromName(blob?.name) ||
      this.#extFromName(obj.path) ||
      this.#extFromMime(obj.mime || blob?.type) ||
      defaultExt;
    return ext ? name + ext : name;
  }
  #extFromName(name) {
    return String(name || '').match(/\.([a-z0-9]+)$/i)?.[0] || '';
  }
  #extFromMime(mime) {
    const m = String(mime || '').toLowerCase().trim().replace(/^\./, '');
    const map = {
      'jpg': '.jpg',
      'jpeg': '.jpg',
      'png': '.png',
      'gif': '.gif',
      'webp': '.webp',
      'avif': '.avif',
      'bmp': '.bmp',
      'svg': '.svg',
      'heic': '.heic',
      'tiff': '.tiff',
      'pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/x-png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/avif': '.avif',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'image/heic': '.heic',
      'image/tiff': '.tiff',
      'application/pdf': '.pdf'
    };
    if (m.startsWith('image/')) {
      const subtype = m.slice(6).split(/[;+]/)[0];
      if (subtype === 'jpeg') return '.jpg';
      if (subtype === 'svg+xml') return '.svg';
      if (/^[a-z0-9]+$/i.test(subtype)) return '.' + subtype;
    }
    return map[m] || '';
  }
  // Replace every [[id]] token in guide content with plain text, so a deleted
  // entity leaves a readable name behind instead of a dangling [[item_x]].
  #replaceRefTokens(id, name, kind = null) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = kind === 'attachment' ? this.#findEntity(id) : null;
    const imgName = found?.kind === 'attachment' ? this.#attachmentNameWithExt(found.obj, '.png') : name;
    const videoName = found?.kind === 'attachment' ? this.#attachmentNameWithExt(found.obj, '.mp4') : name;
    const patterns = [
      { re: new RegExp('\\[\\[' + esc + '\\]\\]', 'g'), value: name },
      ...(kind === 'attachment' ? [
        { re: new RegExp('\\[\\[img:' + esc + '\\]\\]', 'g'), value: imgName },
        { re: new RegExp('\\[\\[video:' + esc + '\\]\\]', 'g'), value: videoName }
      ] : [])
    ];
    for (const g of this.data.guides || []) {
      if (!g.content) continue;
      for (const lang of Object.keys(g.content)) {
        if (typeof g.content[lang] === 'string') {
          for (const { re, value } of patterns) g.content[lang] = g.content[lang].replace(re, value);
        }
      }
    }
  }

  deleteEntity(id) {
    if (!this.data) return;
    const found = this.#findEntity(id);
    if (found) this.#replaceRefTokens(id, this.#nameOf(found.obj, found.kind), found.kind);
    if (found?.kind === 'role') {
      this.deleteRole(id);
      return;
    }
    if (found?.kind === 'readiness') {
      this.deleteReadinessCheck(id);
      return;
    }
    if (found?.kind === 'task') {
      this.deleteReadinessTask(id);
      return;
    }
    for (const k of KINDS) {
      const arr = this.data[k]; if (!arr) continue;
      const i = arr.findIndex((o) => o.id === id);
      if (i >= 0) { arr.splice(i, 1); break; }
    }
    this.#scrubRefs(id);
  }

  /** Delete every reference to a deleted id so nothing dangles. */
  #scrubRefs(id) {
    const rm = (arr) => this.#rm(arr, id);
    for (const p of this.data.people || []) {
      if (p.location_id === id) delete p.location_id;
      for (const st of p.access_path?.steps || []) {
        if (st.ref_id === id) delete st.ref_id;
        if (st.photo_id === id) delete st.photo_id;
      }
    }
    for (const l of this.data.locations || []) { if (l.parent_id === id) delete l.parent_id; rm(l.access_person_ids); rm(l.depends_on_ids); }
    for (const it of this.data.items || []) { rm(it.location_ids); rm(it.container_ids); rm(it.access_person_ids); rm(it.depends_on_ids); rm(it.guide_ids); rm(it.attachment_ids); }
    for (const g of this.data.guides || []) {
      rm(g.audience_person_ids);
      if (g.references) for (const key of Object.keys(g.references)) rm(g.references[key]);
      if (g.folder_id === id) delete g.folder_id;
    }
    for (const a of this.data.attachments || []) {
      if (a.item_id === id) delete a.item_id;
      if (a.guide_id === id) delete a.guide_id;
      rm(a.item_ids);
      rm(a.guide_ids);
    }
    for (const c of this.data.readiness_checks || []) {
      rm(c.person_ids);
      rm(c.role_ids);
      rm(c.related_person_ids);
      rm(c.related_item_ids);
      rm(c.related_location_ids);
      rm(c.related_guide_ids);
      rm(c.related_attachment_ids);
    }
    for (const t of this.data.readiness_tasks || []) {
      rm(t.person_ids);
      rm(t.location_ids);
    }
    if (this.data.package?.owner_id === id) delete this.data.package.owner_id;
    rm(this.data.package?.primary_person_ids);
    rm(this.data.package?.map_audience_person_ids);
  }
}
