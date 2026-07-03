/*
  Password encryption for a package, reusing freedomclock.io's scheme:
  AES-256-GCM with a PBKDF2-SHA256 derived key (random salt + IV).

  The result is a self-describing JSON envelope (`lifepackage-encrypted/v1`) that
  records the algorithm and parameters, so the package can be decrypted WITHOUT
  this app by anyone who reads the spec (see FORMAT.md for a standalone recipe).
  The plaintext inside is the package `.zip`.

  Works in the browser and in Node 18+ (both expose Web Crypto as globalThis.crypto).
*/

import { ENCRYPTED_FORMAT, ENCRYPTED_FORMATS } from './format.js';

const ENC = new TextEncoder();

// Minimum password length we recommend / the Builder will enforce.
export const MIN_PASSWORD_LENGTH = 12;
// OWASP 2023 guidance for PBKDF2-HMAC-SHA256. Stored in the envelope, so it can
// be raised later without breaking older files.
export const DEFAULT_ITERATIONS = 600000;

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

async function deriveKey(password, salt, iterations, usage) {
  const keyMaterial = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

export function isEncryptedEnvelope(obj) {
  return !!obj && typeof obj === 'object' && ENCRYPTED_FORMATS.includes(obj.format);
}

// The envelope's plaintext metadata is bound to the ciphertext as AES-GCM
// additional authenticated data (AAD), so a tamperer can't quietly rewrite the
// visible `hint` (e.g. into a phishing instruction for a grieving heir) without
// breaking decryption. `aad: "v1"` in the envelope signals this binding; older
// envelopes without it decrypt as before.
const AAD_VERSION = 'v1';

function buildAad(format, content, hint) {
  return ENC.encode(`lifepackage-aad/${AAD_VERSION}\n${format}\n${content}\n${hint || ''}`);
}

/** Encrypt raw bytes (the package .zip) into a JSON envelope object. */
export async function encryptToEnvelope(plainBytes, password, { iterations = DEFAULT_ITERATIONS, hint = '', content = 'package-zip' } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations, ['encrypt']);
  const additionalData = buildAad(ENCRYPTED_FORMAT, content, hint);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plainBytes);
  return {
    format: ENCRYPTED_FORMAT,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ct),
    content,
    aad: AAD_VERSION,
    ...(hint ? { hint } : {})
  };
}

/** Decrypt an envelope back to the raw bytes (the package .zip). Throws on wrong password. */
export async function decryptEnvelope(env, password) {
  if (!isEncryptedEnvelope(env)) throw new Error('This file is not an encrypted life package.');
  const salt = b64decode(env.salt);
  const iv = b64decode(env.iv);
  const ct = b64decode(env.ciphertext);
  const key = await deriveKey(password, salt, env.iterations || DEFAULT_ITERATIONS, ['decrypt']);
  const params = { name: 'AES-GCM', iv };
  if (env.aad === AAD_VERSION) {
    params.additionalData = buildAad(env.format, env.content || 'package-zip', env.hint);
  }
  try {
    const plain = await crypto.subtle.decrypt(params, key, ct);
    return new Uint8Array(plain);
  } catch {
    throw new Error(
      env.aad === AAD_VERSION
        ? 'Wrong password — or the file was damaged or tampered with (its hint/label no longer matches what was sealed).'
        : 'Wrong password, or the file is damaged.'
    );
  }
}
