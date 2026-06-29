/*
  Password encryption for a package, reusing freedomclock.io's scheme:
  AES-256-GCM with a PBKDF2-SHA256 derived key (random salt + IV).

  The result is a self-describing JSON envelope (`inheritance-encrypted/v1`) that
  records the algorithm and parameters, so the package can be decrypted WITHOUT
  this app by anyone who reads the spec (see FORMAT.md for a standalone recipe).
  The plaintext inside is the package `.zip`.

  Works in the browser and in Node 18+ (both expose Web Crypto as globalThis.crypto).
*/

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
  return !!obj && typeof obj === 'object' && obj.format === 'inheritance-encrypted/v1';
}

/** Encrypt raw bytes (the package .zip) into a JSON envelope object. */
export async function encryptToEnvelope(plainBytes, password, { iterations = DEFAULT_ITERATIONS, hint = '', content = 'package-zip' } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  return {
    format: 'inheritance-encrypted/v1',
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ct),
    content,
    ...(hint ? { hint } : {})
  };
}

/** Decrypt an envelope back to the raw bytes (the package .zip). Throws on wrong password. */
export async function decryptEnvelope(env, password) {
  if (!isEncryptedEnvelope(env)) throw new Error('This file is not an encrypted inheritance package.');
  const salt = b64decode(env.salt);
  const iv = b64decode(env.iv);
  const ct = b64decode(env.ciphertext);
  const key = await deriveKey(password, salt, env.iterations || DEFAULT_ITERATIONS, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(plain);
  } catch {
    throw new Error('Wrong password, or the file is damaged.');
  }
}
