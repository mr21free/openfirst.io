/*
  Local draft persistence in IndexedDB — so an in-progress edit survives a
  refresh or crash. Entirely on-device (no server). Each plan is stored under
  its own key (data.package.id), so multiple drafts can coexist.

  Three object stores:
   - 'drafts': the plan JSON + savedAt, one record per plan key. Small, cheap
     to rewrite on every autosave.
   - 'blobs': attachment files, one record per `planKey + '\\u0000' + attachmentId`.
     Written only when a file is added/replaced and deleted when it's removed —
     so typing in a big plan never rewrites megabytes of attachments.
   - 'handles': the File System Access handle the app is autosaving into for a
     given plan (keyed by planId), so reopening the app can silently
     reconnect instead of asking again where the plan lives.

  (v1 stored the blobs inline in the draft record; loadDraft still reads that
  shape and flags it so the caller can migrate on the next save.)

  Everything is wrapped so that if IndexedDB is unavailable (e.g. some file://
  contexts), the app keeps working — it just can't auto-save the draft, and the
  user relies on Export instead.
*/

const DB_NAME = 'lifepackage';
const STORE = 'drafts';
const BLOBS = 'blobs';
const HANDLES = 'handles';
const SEP = '\u0000'; // can't appear in a plan key ↔ unambiguous blob keys

export function persistenceAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

// Cached across calls — re-opening a fresh connection on every autosave adds
// a real, avoidable round trip right when latency matters most (a flush
// racing page teardown on refresh/close, see store.svelte.js's
// flushPendingChanges). A dropped connection (e.g. another tab's version
// upgrade) just gets reopened on the next call.
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
    };
    req.onsuccess = () => {
      req.result.onclose = () => { dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).catch(reject);
  });
}

const blobRange = (planKey) => IDBKeyRange.bound(planKey + SEP, planKey + SEP + '\uffff');

/**
 * Save the plan draft (no blobs). Plaintext record = { data, savedAt } —
 * or an encrypted one = { enc, salt, iterations, iv, ct, title, savedAt }
 * (see draftcrypto.js), which carries no readable plan and therefore needs the
 * explicit `key`. Stored under data.package.id / `key` / 'current'.
 */
export async function saveDraft(record, key = null) {
  if (!persistenceAvailable()) return false;
  try {
    const k = key || record.data?.package?.id || 'current';
    await run(STORE, 'readwrite', (s) => s.put(record, k));
    return true;
  } catch {
    return false;
  }
}

/** Write/replace one attachment blob for a plan. */
export async function saveDraftBlob(planKey, attachmentId, blob) {
  if (!persistenceAvailable()) return false;
  try {
    await run(BLOBS, 'readwrite', (s) => s.put(blob, planKey + SEP + attachmentId));
    return true;
  } catch {
    return false;
  }
}

/** Remove one attachment blob for a plan. */
export async function deleteDraftBlob(planKey, attachmentId) {
  if (!persistenceAvailable()) return;
  try {
    await run(BLOBS, 'readwrite', (s) => s.delete(planKey + SEP + attachmentId));
  } catch {
    /* ignore */
  }
}

async function loadDraftBlobs(planKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS, 'readonly');
    const s = tx.objectStore(BLOBS);
    const keysReq = s.getAllKeys(blobRange(planKey));
    const valsReq = s.getAll(blobRange(planKey));
    tx.oncomplete = () => {
      const keys = keysReq.result || [];
      const vals = valsReq.result || [];
      resolve(keys.map((k, i) => ({ id: String(k).slice(planKey.length + 1), blob: vals[i] })));
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Load one draft: { data, savedAt, attachments: [{ id, blob }], legacyBlobs }.
 * `legacyBlobs` is true when the blobs still live inline in a v1 record — the
 * caller should re-persist them (they're rewritten to the blob store on the
 * next save cycle).
 */
export async function loadDraft(key = 'current') {
  if (!persistenceAvailable()) return null;
  try {
    const record = await run(STORE, 'readonly', (s) => s.get(key));
    if (!record) return null;
    // A protected (Container Format v2) record carries its own encrypted
    // `attachments` map (id -> {iv, mime, data}) — a completely different
    // shape from the legacy blob-store merge below. Protected drafts never
    // write to the plaintext 'blobs' store (see store.svelte.js's
    // #syncBlobs), so there's nothing to merge in; doing so anyway would
    // clobber the real encrypted map with the wrong shape.
    if (record.slots?.length) return { ...record, legacyBlobs: false };
    const stored = await loadDraftBlobs(key).catch(() => []);
    if (stored.length || !record.attachments?.length) {
      return { ...record, attachments: stored, legacyBlobs: false };
    }
    // v1 record: blobs were embedded in the draft itself.
    return { ...record, legacyBlobs: true };
  } catch {
    return null;
  }
}

/** Returns all saved drafts (no blobs, no decryption) as
 *  [{ key, data, savedAt, enc, title, slots }] — `enc`/`title` are set for
 *  the old single-passphrase scheme, `slots` for the current multi-passphrase
 *  one (slotcrypto.js); either way the plan JSON isn't readable here. */
export async function loadAllDrafts() {
  if (!persistenceAvailable()) return [];
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const s = tx.objectStore(STORE);
      const keysReq = s.getAllKeys();
      const valsReq = s.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result || [];
        const vals = valsReq.result || [];
        resolve(keys.map((k, i) => {
          const { data, savedAt, enc, title, slots } = vals[i] || {};
          return { key: k, data, savedAt, enc, title, slots };
        }));
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

export async function clearDraft(key = 'current') {
  if (!persistenceAvailable()) return;
  try {
    await run(STORE, 'readwrite', (s) => s.delete(key));
    await run(BLOBS, 'readwrite', (s) => s.delete(blobRange(key)));
  } catch {
    /* ignore */
  }
}

/**
 * Remember the file handle a plan autosaves into, keyed by planId — so
 * reopening the app can silently try to reconnect (see store.svelte.js).
 * `fileRevision` is the revision most recently and successfully written to
 * that file; kept here (not just in memory) so a reload knows whether the
 * file is caught up or behind before a single new edit happens.
 * `protected` mirrors whether the file currently has passphrase slots —
 * recorded here (not just derived from the local scratch draft, which is
 * only written on a real edit) so the launcher's lock icon is correct
 * immediately, even for a plan whose file this browser has never edited.
 */
export async function putFileHandle(planId, name, handle, fileRevision = 0, protectedFlag = false) {
  if (!persistenceAvailable() || !planId) return false;
  try {
    await run(HANDLES, 'readwrite', (s) => s.put({ name, handle, fileRevision, protected: protectedFlag, lastOpenedAt: Date.now() }, planId));
    return true;
  } catch {
    return false;
  }
}

export async function getFileHandle(planId) {
  if (!persistenceAvailable() || !planId) return null;
  try {
    return (await run(HANDLES, 'readonly', (s) => s.get(planId))) || null;
  } catch {
    return null;
  }
}

/** Returns every remembered file connection as
 *  [{ planId, name, handle, fileRevision, lastOpenedAt }] — `handle` is `null`
 *  for a plan homed via the no-File-System-Access fallback download path.
 *  Drives the launcher's file-backed "recent plans" list (see App.svelte). */
export async function getAllFileHandles() {
  if (!persistenceAvailable()) return [];
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLES, 'readonly');
      const s = tx.objectStore(HANDLES);
      const keysReq = s.getAllKeys();
      const valsReq = s.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result || [];
        const vals = valsReq.result || [];
        resolve(keys.map((k, i) => ({ planId: k, ...vals[i] })));
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

export async function deleteFileHandle(planId) {
  if (!persistenceAvailable() || !planId) return;
  try {
    await run(HANDLES, 'readwrite', (s) => s.delete(planId));
  } catch {
    /* ignore */
  }
}
