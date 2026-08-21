/*
  Multi-passphrase container encryption — Container Format v1's "passphrase"
  protection (see FORMAT.md, recover.js, generate.mjs). One random master key
  encrypts the plan data directly; each slot independently wraps that same
  master key under a passphrase-derived key, so any one of N passphrases
  recovers the plan, and removing one slot doesn't touch the others. This is
  byte-compatible with recover.js/recover.py — same AAD strings, same KDF/
  cipher parameters — so a file this module writes opens with the standalone
  recovery script, and a file recover.js can read, this module can too.
*/

import { DEFAULT_ITERATIONS } from './crypto.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const AAD_VERSION = 'v1';

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000; // avoid arg-limit blowups on large buffers
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Binds `formatVersion` — otherwise-unauthenticated plaintext that decides
// whether readContainer even looks at the top-level `attachments` map (see
// FORMAT.md). Without this, flipping formatVersion from 2 to 1 on a tampered
// file makes every attachment silently disappear on open (no error) instead
// of being caught as tampering.
function aadMain(planId, revision, formatVersion) {
  return ENC.encode(`lifepackage-plan-aad/v2\n${planId}\n${revision}\n${formatVersion}`);
}

// Pre-formatVersion-binding AAD, from before the guard above existed — kept
// so a file written before this fix still opens (see decryptContainerData).
// A newly-written, newly-tampered file still fails here too: its ciphertext
// tag was computed under aadMain's *real* formatVersion, which this legacy
// string never included, so the two only ever coincide for a genuinely old
// file that predates the aadMain change.
function aadMainLegacy(planId, revision) {
  return ENC.encode(`lifepackage-plan-aad/${AAD_VERSION}\n${planId}\n${revision}`);
}

function aadSlot(planId, slotId, label, hint) {
  return ENC.encode(`lifepackage-plan-slot-aad/${AAD_VERSION}\n${planId}\n${slotId}\n${label}\n${hint || ''}`);
}

// Deliberately NOT bound to `revision` (unlike aadMain) — this is what lets
// Container Format v2 cache and reuse an unchanged attachment's ciphertext
// across saves instead of re-encrypting it every time (see FORMAT.md). Same
// (key, plaintext) reused across saves is fine for GCM; what GCM forbids is
// reusing a (key, iv) pair for two *different* plaintexts, and a fresh random
// iv is drawn on every encrypt below regardless of whether the plaintext
// changed. `mime` *is* bound, though: it sits in plaintext right next to the
// ciphertext (so the UI can pick a preview before unlock), and without this
// it's a free, undetectable tamper target for whatever renders it.
function aadAttachment(planId, attachmentId, mime) {
  return ENC.encode(`lifepackage-plan-attachment-aad/v2\n${planId}\n${attachmentId}\n${mime || ''}`);
}

// Pre-mime-binding AAD — see aadMainLegacy above for why this has to stay.
function aadAttachmentLegacy(planId, attachmentId) {
  return ENC.encode(`lifepackage-plan-attachment-aad/${AAD_VERSION}\n${planId}\n${attachmentId}`);
}

async function deriveSlotKey(passphrase, salt, iterations, usage) {
  const material = await crypto.subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

function genSlotId() {
  return 'slot_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function generateMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Wrap `masterKeyRaw` under a new passphrase-derived slot — matches
 *  generate.mjs's `makeSlot` exactly (same AAD, same field names). */
export async function wrapMasterKeyForSlot({ masterKeyRaw, passphrase, label, hint, planId, slotId = null, iterations = DEFAULT_ITERATIONS }) {
  const id = slotId || genSlotId();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSlotKey(passphrase, salt, iterations, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadSlot(planId, id, label, hint) },
    key,
    masterKeyRaw
  );
  return { id, label, hint, iterations, salt: b64encode(salt), iv: b64encode(iv), wrappedKey: b64encode(wrapped) };
}

/** Try one passphrase against every slot in order (mirrors recover.js's
 *  `recover()` loop) — a per-slot decrypt failure is an expected "wrong slot"
 *  outcome, not a hard error; only failing every slot throws. */
export async function unwrapMasterKey({ slots, passphrase, planId }) {
  const errors = [];
  for (const slot of slots || []) {
    try {
      const key = await deriveSlotKey(passphrase, b64decode(slot.salt), slot.iterations, ['decrypt']);
      const iv = b64decode(slot.iv);
      const wrapped = b64decode(slot.wrappedKey);
      const aad = aadSlot(planId, slot.id, slot.label || '', slot.hint || '');
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, wrapped);
      return { masterKeyRaw: new Uint8Array(raw), slotId: slot.id };
    } catch (err) {
      errors.push(`${slot.label || slot.id}: ${err.message || err}`);
    }
  }
  throw new Error('That password didn’t unlock any slot on this plan.');
}

/** Encrypt the plan data under the master key: `{ iv, data }` (both base64),
 *  AAD = `aadMain` — binds `revision` (so a stale ciphertext can never be
 *  replayed against a newer one) and `formatVersion` (see aadMain above). */
export async function encryptContainerData({ masterKeyRaw, planId, revision, formatVersion, dataObj }) {
  const key = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = ENC.encode(JSON.stringify(dataObj));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadMain(planId, revision, formatVersion) },
    key,
    plaintext
  );
  return { iv: b64encode(iv), data: b64encode(ciphertext) };
}

/** Decrypt a protected container's `data` back to the plain object. Tries the
 *  current formatVersion-bound AAD first, then falls back to the pre-fix AAD
 *  (see aadMainLegacy) — mirrors unwrapMasterKey's per-slot try/fallback. */
export async function decryptContainerData({ container, masterKeyRaw }) {
  const key = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['decrypt']);
  const iv = b64decode(container.iv);
  const ciphertext = b64decode(container.data);
  try {
    const aad = aadMain(container.planId, container.revision, container.formatVersion);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
    return JSON.parse(DEC.decode(plain));
  } catch {
    const aad = aadMainLegacy(container.planId, container.revision);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
    return JSON.parse(DEC.decode(plain));
  }
}

/** Container Format v2 (see FORMAT.md): each attachment is encrypted
 *  independently of the plan-data blob and of every other attachment, under
 *  its own fresh random iv but the same master key, with AAD binding it to
 *  this plan + this attachment id only (not `revision` — see aadAttachment).
 *  That's what lets an unchanged attachment's ciphertext be cached and
 *  reused across saves instead of re-encrypted every time. */
export async function encryptAttachment({ masterKeyRaw, planId, attachmentId, mime, bytes }) {
  const key = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadAttachment(planId, attachmentId, mime) },
    key,
    bytes
  );
  return { iv: b64encode(iv), mime: mime || '', data: b64encode(ciphertext) };
}

/** Decrypt one v2 attachment entry back to raw bytes. Tries the current
 *  mime-bound AAD first, then falls back to the pre-fix AAD (see
 *  aadAttachmentLegacy) — mirrors decryptContainerData's fallback. */
export async function decryptAttachment({ masterKeyRaw, planId, attachmentId, entry }) {
  const key = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['decrypt']);
  const iv = b64decode(entry.iv);
  const ciphertext = b64decode(entry.data);
  try {
    const aad = aadAttachment(planId, attachmentId, entry.mime);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    const aad = aadAttachmentLegacy(planId, attachmentId);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
    return new Uint8Array(plain);
  }
}
