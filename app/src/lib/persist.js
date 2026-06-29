/*
  Local draft persistence in IndexedDB — so an in-progress edit survives a
  refresh or crash. Entirely on-device (no server). Each plan is stored under
  its own key (data.package.id), so multiple drafts can coexist.

  Everything is wrapped so that if IndexedDB is unavailable (e.g. some file://
  contexts), the app keeps working — it just can't auto-save the draft, and the
  user relies on Export instead.
*/

const DB_NAME = 'lifepackage';
const STORE = 'drafts';

export function persistenceAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).catch(reject);
  });
}

/**
 * record = { data, attachments: [{ id, blob }], savedAt: ISOstring }
 * Each plan is stored under its own key (data.package.id || 'current').
 */
export async function saveDraft(record) {
  if (!persistenceAvailable()) return false;
  try {
    const key = record.data?.package?.id || 'current';
    await run('readwrite', (s) => s.put(record, key));
    return true;
  } catch {
    return false;
  }
}

export async function loadDraft(key = 'current') {
  if (!persistenceAvailable()) return null;
  try {
    return (await run('readonly', (s) => s.get(key))) || null;
  } catch {
    return null;
  }
}

/** Returns all saved drafts as [{ key, data, attachments, savedAt }]. */
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
        resolve(keys.map((k, i) => ({ key: k, ...(vals[i] || {}) })));
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
    await run('readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}
