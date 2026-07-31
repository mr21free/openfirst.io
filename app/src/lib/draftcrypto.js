/*
  Superseded by slotcrypto.js's multi-passphrase scheme (Iteration 3) — kept
  only so App.svelte's migration path can still decrypt a draft that was
  protected under this single-passphrase, IndexedDB-only scheme before that
  update, then re-wrap it into a slot under the new scheme. Nothing writes
  this format anymore.

  Same primitives as the export envelope (PBKDF2-SHA256 → AES-256-GCM), one
  derived key per plan held ONLY in memory while editing.
*/

import { DEFAULT_ITERATIONS } from './crypto.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export const DRAFT_ENC_VERSION = 'v1';

// Domain-separate the GCM from the export envelope, and bind each record to
// its plan so ciphertexts can't be swapped between plans.
const aad = (planKey) => ENC.encode(`lifepackage-draft/${DRAFT_ENC_VERSION}\n${planKey}`);

export function newDraftSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveDraftKey(passphrase, salt, iterations = DEFAULT_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytes(key, planKey, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(planKey) }, key, bytes);
  return { iv, ct };
}

export async function decryptBytes(key, planKey, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(planKey) }, key, ct);
  return new Uint8Array(pt);
}

export async function encryptString(key, planKey, str) {
  return encryptBytes(key, planKey, ENC.encode(str));
}

export async function decryptString(key, planKey, iv, ct) {
  return DEC.decode(await decryptBytes(key, planKey, iv, ct));
}

/** Is a stored draft record / blob value one of ours, encrypted? */
export function isEncryptedRecord(v) {
  return !!v && typeof v === 'object' && v.enc === DRAFT_ENC_VERSION;
}

export async function encryptBlob(key, planKey, blob) {
  const { iv, ct } = await encryptBytes(key, planKey, new Uint8Array(await blob.arrayBuffer()));
  return { enc: DRAFT_ENC_VERSION, iv, ct, mime: blob.type || '' };
}

export async function decryptToBlob(key, planKey, value) {
  const bytes = await decryptBytes(key, planKey, value.iv, value.ct);
  return new Blob([bytes], { type: value.mime || '' });
}
