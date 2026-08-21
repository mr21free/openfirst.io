/*
  Builds the plan .html file itself — the container described in FORMAT.md's
  "Container Format v1": a static front door, a data island, and the same
  embedded app bundle the reader export already produces. This is what the
  app's file-autosave (see store.svelte.js) writes into the user's chosen
  file, and what "Make a copy" / homing will hand to a file picker or a
  download.
*/

import { readerTemplateRoot, stripUnusedFonts, fontsToKeep, blobToB64, b64ToBlob, mimeForAttachment } from './export.js';
import { encryptContainerData, decryptContainerData, encryptAttachment, decryptAttachment } from './slotcrypto.js';
import RECOVER_JS_SOURCE from '../../recover.js?raw';

export const CONTAINER_FORMAT = 'lifepackage-plan/v1';
export const CONTAINER_FORMAT_VERSION = 1;
// Container Format v2 (see FORMAT.md): protected plans only. Every other
// shape (unprotected, or an already-written v1 protected file) is read
// forever — this only changes what *new* protected saves write.
export const CONTAINER_FORMAT_VERSION_V2 = 2;

/** Turn a plan title into a stable, filesystem-safe file name — no date, no
 *  suffix: this is the file the app keeps saving into (see the filename
 *  ownership rule in CHANGES.md). Only "Make a copy" ever stamps a date. */
export function suggestedFileName(title) {
  const base = String(title || 'Untitled Plan')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${base || 'Plan'}.html`;
}

// A cache entry is only reused when the *same* Blob object (reference
// equality) is still attached to this attachment id — any add/replace of a
// file swaps in a new Blob, which naturally invalidates the old entry
// without needing an explicit "did this change" check. `kind` lets a single
// cache Map safely hold both plain and encrypted entries for the same id
// across a protect/unprotect toggle (the wrong-kind entry just won't match
// and gets recomputed) — see store.svelte.js's `#attachmentCache`.
async function cachedPlainEntry(cache, att, blob) {
  const cached = cache.get(att.id);
  if (cached && cached.kind === 'plain' && cached.blob === blob) return cached.value;
  const value = await blobToB64(blob, att);
  cache.set(att.id, { kind: 'plain', blob, value });
  return value;
}

async function cachedEncryptedEntry(cache, { masterKeyRaw, planId, att, blob }) {
  const cached = cache.get(att.id);
  if (cached && cached.kind === 'encrypted' && cached.blob === blob) return cached.value;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || mimeForAttachment(att) || '';
  const value = await encryptAttachment({ masterKeyRaw, planId, attachmentId: att.id, mime, bytes });
  cache.set(att.id, { kind: 'encrypted', blob, value });
  return value;
}

/** Assemble the container JSON.
 *
 *  Unprotected (`protection = null`): unchanged Container Format v1 shape —
 *  every attachment blob is base64-encoded and merged into
 *  `data.attachmentBlobs`.
 *
 *  Protected (`protection = { masterKeyRaw, slots }`): Container Format v2 —
 *  two independently-encrypted buckets instead of one monolithic blob. The
 *  plan JSON/text (`data`, *without* attachment bytes) is encrypted exactly
 *  as v1 did (cheap, revision-bound AAD). Each attachment is encrypted
 *  independently under its own fresh iv into the top-level `attachments`
 *  map, keyed by attachment id, with AAD bound to the plan + that id only
 *  (not revision) — see slotcrypto.js's `encryptAttachment`. That's what
 *  makes an unchanged attachment's ciphertext cacheable: `attachmentCache`
 *  (an id → {kind,blob,value} Map the caller persists across calls) is
 *  consulted before re-encrypting/re-encoding anything, so a save where no
 *  attachment changed does zero attachment crypto work.
 *
 *  A v1-protected file opened by this app and re-saved is transparently
 *  upgraded to v2 the next time it's written — see FORMAT.md. */
export async function buildContainer({ planId, revision, data, blobs = new Map(), protection = null, attachmentCache = new Map() }) {
  const base = {
    format: CONTAINER_FORMAT,
    planId,
    revision,
    updated: new Date().toISOString()
  };
  const title = data.package?.title || 'Untitled Plan';

  if (!protection) {
    const attachmentBlobs = {};
    for (const att of data.attachments || []) {
      const blob = blobs.get(att.id);
      if (blob) attachmentBlobs[att.id] = await cachedPlainEntry(attachmentCache, att, blob);
    }
    return {
      ...base,
      formatVersion: CONTAINER_FORMAT_VERSION,
      protection: 'none',
      title,
      data: { ...data, attachmentBlobs }
    };
  }

  const attachments = {};
  for (const att of data.attachments || []) {
    const blob = blobs.get(att.id);
    if (blob) attachments[att.id] = await cachedEncryptedEntry(attachmentCache, { masterKeyRaw: protection.masterKeyRaw, planId, att, blob });
  }
  const { iv, data: cipherData } = await encryptContainerData({
    masterKeyRaw: protection.masterKeyRaw, planId, revision, formatVersion: CONTAINER_FORMAT_VERSION_V2, dataObj: data
  });
  return {
    ...base,
    formatVersion: CONTAINER_FORMAT_VERSION_V2,
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title,
    slots: protection.slots,
    iv,
    data: cipherData,
    attachments
  };
}

/** Decrypt/unpack a container (either format version, protected or not) back
 *  to `{ data, attachmentUrls, blobs }` — the one shape the store and
 *  App.svelte's boot/unlock paths all want. `masterKeyRaw` is required only
 *  for a passphrase-protected container (already unwrapped by the caller via
 *  `unwrapMasterKey`). Handles every combination a real file can be in:
 *  unprotected v1, protected v1 (attachments embedded in the encrypted
 *  `data` blob), protected v2 (attachments independently encrypted in the
 *  top-level `attachments` map). */
export async function readContainer({ container, masterKeyRaw = null }) {
  const version = container.formatVersion || 1;
  const data = container.protection === 'passphrase'
    ? await decryptContainerData({ container, masterKeyRaw })
    : (container.data || {});

  const attachmentUrls = {};
  const blobs = new Map();

  if (version >= 2 && container.attachments) {
    for (const [id, entry] of Object.entries(container.attachments)) {
      const bytes = await decryptAttachment({ masterKeyRaw, planId: container.planId, attachmentId: id, entry });
      const att = data.attachments?.find((x) => x.id === id);
      const blob = new Blob([bytes], { type: entry.mime || att?.mime || '' });
      blobs.set(id, blob);
      attachmentUrls[id] = URL.createObjectURL(blob);
    }
    return { data, attachmentUrls, blobs };
  }

  const { attachmentBlobs, ...rest } = data;
  for (const [id, a] of Object.entries(attachmentBlobs || {})) {
    const att = rest.attachments?.find((x) => x.id === id);
    const blob = b64ToBlob(a.b64, a.mime || att?.mime || '');
    blobs.set(id, blob);
    attachmentUrls[id] = URL.createObjectURL(blob);
  }
  return { data: rest, attachmentUrls, blobs };
}

function frontDoorHtml(container) {
  const slotsHtml = container.protection === 'passphrase'
    ? `<ul>${(container.slots || []).map((s) => `<li>${s.label}${s.hint ? ` — hint: ${s.hint}` : ''}</li>`).join('')}</ul>`
    : `<p>No passphrase — this file opens for anyone who has it.</p>`;
  return `<div id="openfirst-front-door" style="display:none">
  <p>OpenFirst plan file — container format v${container.formatVersion} (${container.format})</p>
  <h1>${container.title}</h1>
  <p>Plan id: ${container.planId} — revision ${container.revision} — last saved ${container.updated}</p>
  ${slotsHtml}
</div>`;
}

/**
 * Build the full plan .html: the static front door, the data island, a
 * small bridging script that feeds the existing `window.__LIFE_PACKAGE__`
 * boot path (so App.svelte needs no change to *how* it reads the global,
 * only to how it interprets the container-v1 shape), the embedded
 * `recover.js` source, and then the app's own bundle — reusing the exact
 * template-cloning/font-stripping path the reader export already uses.
 */
export async function buildPlanFileHtml(container, keepFonts = null) {
  const docEl = (await readerTemplateRoot()).cloneNode(true);
  docEl.removeAttribute('data-theme');
  if (keepFonts) stripUnusedFonts(docEl, keepFonts);
  const app = docEl.querySelector('#app');
  if (app) app.innerHTML = '';
  docEl.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());

  const body = docEl.querySelector('body');
  const json = JSON.stringify(container).replace(/</g, '\\u003c');
  const recoverJs = RECOVER_JS_SOURCE.replace(/<\/script/gi, '<\\/script');

  const front = document.createElement('div');
  front.innerHTML = frontDoorHtml(container);
  body.insertBefore(front.firstElementChild, body.firstChild);

  const dataIsland = document.createElement('script');
  dataIsland.type = 'application/json';
  dataIsland.id = 'openfirst-plan-data';
  dataIsland.textContent = json;
  body.insertBefore(dataIsland, front.nextSibling);

  const bridge = document.createElement('script');
  bridge.textContent =
    "window.__LIFE_PACKAGE__=JSON.parse(document.getElementById('openfirst-plan-data').textContent);";
  body.insertBefore(bridge, dataIsland.nextSibling);

  const marker = document.createComment(
    ' OPENFIRST-RECOVERY-SCRIPT: everything in the next tag is recover.js, verbatim '
  );
  body.insertBefore(marker, bridge.nextSibling);

  const recoverScript = document.createElement('script');
  recoverScript.type = 'text/plain';
  recoverScript.id = 'openfirst-recover-js';
  recoverScript.textContent = recoverJs;
  body.insertBefore(recoverScript, marker.nextSibling);

  const notice = `<!--
  This is an OpenFirst plan file. To read it without OpenFirst: open this
  file in a text editor, find the recovery script marker further down (view
  source, then search for OPENFIRST-RECOVERY-SCRIPT), copy everything below
  that marker up to the closing tag into a new file named recover.js, then
  run: node recover.js THIS-FILE.html
-->`;
  return `<!doctype html>\n${notice}\n${docEl.outerHTML}`;
}

/** Read a container back out of its own .html (iteration 2b: the file becomes
 *  authoritative on reconnect — see store.svelte.js's `openFromFile`). Mirrors
 *  exactly what the bridge script above feeds `window.__LIFE_PACKAGE__` from:
 *  the same `#openfirst-plan-data` data island, same JSON shape. */
export function parseContainerFromHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const island = doc.getElementById('openfirst-plan-data');
    if (!island) return null;
    return JSON.parse(island.textContent);
  } catch {
    return null;
  }
}
