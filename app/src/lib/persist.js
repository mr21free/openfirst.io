/*
  Local draft persistence in IndexedDB — so an in-progress edit survives a
  refresh or crash. Entirely on-device (no server). Each plan is stored under
  its own key (data.package.id), so multiple drafts can coexist.

  Two object stores:
   - 'drafts': the plan JSON + savedAt, one record per plan key. Small, cheap
     to rewrite on every autosave.
   - 'blobs': attachment files, one record per `planKey + '\\u0000' + attachmentId`.
     Written only when a file is added/replaced and deleted when it's removed —
     so typing in a big plan never rewrites megabytes of attachments.

  (v1 stored the blobs inline in the draft record; loadDraft still reads that
  shape and flags it so the caller can migrate on the next save.)

  Everything is wrapped so that if IndexedDB is unavailable (e.g. some file://
  contexts), the app keeps working — it just can't auto-save the draft, and the
  user relies on Export instead.
*/

const DB_NAME = 'lifepackage';
const STORE = 'drafts';
const BLOBS = 'blobs';
const SEP = '\u0000'; // can't appear in a plan key ↔ unambiguous blob keys

export function persistenceAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
 *  [{ key, data, savedAt, enc, title }] — `enc`/`title` are set for
 *  passphrase-protected drafts, whose plan JSON is not readable here. */
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
          const { data, savedAt, enc, title } = vals[i] || {};
          return { key: k, data, savedAt, enc, title };
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
