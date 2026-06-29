/*
  Diceware passphrase generation + a rough entropy estimate, for the export
  password UI. Entropy — not the KDF — is the real lever against offline attack:
  a 6-word EFF passphrase is ~77 bits, which makes PBKDF2 600k–1M uncrackable.
*/

import { WORDS } from './wordlist.js';

const BITS_PER_WORD = Math.log2(WORDS.length); // 7776 -> 12.925

/** Generate an N-word diceware passphrase using unbiased CSPRNG selection. */
export function generatePassphrase(words = 6, sep = '-') {
  const n = WORDS.length;
  const limit = Math.floor(0x100000000 / n) * n; // rejection sampling: no modulo bias
  const out = [];
  const buf = new Uint32Array(1);
  for (let i = 0; i < words; i++) {
    let r;
    do { crypto.getRandomValues(buf); r = buf[0]; } while (r >= limit);
    out.push(WORDS[r % n]);
  }
  return out.join(sep);
}

export function dicewareBits(words) { return Math.round(words * BITS_PER_WORD); }

/** Rough entropy (bits) of a typed password. Diceware-style input scores by words. */
export function estimateBits(pw) {
  if (!pw) return 0;
  const parts = pw.split(/[-\s_]+/).filter(Boolean);
  if (parts.length >= 3 && parts.every((w) => WORDS.includes(w.toLowerCase()))) {
    return Math.round(parts.length * BITS_PER_WORD);
  }
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  return Math.round(pw.length * Math.log2(pool || 2));
}

export function strength(bits) {
  if (bits < 40) return { label: 'Weak', tone: 'weak' };
  if (bits < 58) return { label: 'Fair', tone: 'ok' };
  if (bits < 75) return { label: 'Strong', tone: 'strong' };
  return { label: 'Very strong', tone: 'vstrong' };
}
