#!/usr/bin/env node
/**
 * Standalone recovery tool for an OpenFirst plan (.html) file. Canonical
 * implementation — this is the copy embedded verbatim inside every plan
 * file, so recovering a plan never depends on this repository, this
 * project, or a package index still being reachable in the future.
 *
 * Needs nothing but a Node runtime: PBKDF2 and AES-GCM come from Node's
 * built-in Web Crypto (the same `crypto.subtle` API the embedded viewer
 * itself uses, and that every browser already ships), not a third-party
 * crypto library.
 *
 * See FORMAT.md, section "The Plan File (.html) — Container Format v1", for
 * the full container spec this implements. A second worked example in
 * Python (recover.py) exists for people who don't have Node; it depends on
 * the `cryptography` package and is tested against the same fixtures as
 * this file, so the two stay honest with each other.
 *
 * Usage:
 *   node recover.js PLAN.html                        # passphrase-free plan
 *   node recover.js PLAN.html --passphrase "..."      # protected plan
 *   node recover.js PLAN.html -o lifepackage.json     # write to a file instead of stdout
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const SUPPORTED_FORMAT = 'lifepackage-plan/v1';
const AAD_VERSION = 'v1';

// Requires type="application/json" (not just the id) — every real plan file
// also embeds this very script's source for future re-export, and that
// source's own error message below contains the literal text
// `<script id="openfirst-plan-data">`, which a looser regex would match
// first (and wrongly) before ever reaching the real data island.
const DATA_ISLAND_RE = /<script[^>]*type=["']application\/json["'][^>]*id=["']openfirst-plan-data["'][^>]*>([\s\S]*?)<\/script>/;

function extractContainer(htmlText) {
  const m = DATA_ISLAND_RE.exec(htmlText);
  if (!m) throw new Error('Could not find the plan\'s data island (expected a script tag, type "application/json", id "openfirst-plan-data") in this file.');
  return JSON.parse(m[1]);
}

function b64decode(str) {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

function aadMain(planId, revision) {
  return ENC.encode(`lifepackage-plan-aad/${AAD_VERSION}\n${planId}\n${revision}`);
}

function aadSlot(planId, slotId, label, hint) {
  return ENC.encode(`lifepackage-plan-slot-aad/${AAD_VERSION}\n${planId}\n${slotId}\n${label}\n${hint || ''}`);
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function unwrapMasterKey(slot, passphrase, planId) {
  const key = await deriveKey(passphrase, b64decode(slot.salt), slot.iterations);
  const iv = b64decode(slot.iv);
  const wrapped = b64decode(slot.wrappedKey);
  const aad = aadSlot(planId, slot.id, slot.label || '', slot.hint || '');
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, wrapped);
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

async function decryptData(container, masterKey) {
  const iv = b64decode(container.iv);
  const ciphertext = b64decode(container.data);
  const aad = aadMain(container.planId, container.revision);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, masterKey, ciphertext);
  return JSON.parse(DEC.decode(plain));
}

async function recover(container, passphrase) {
  if (container.format !== SUPPORTED_FORMAT) {
    throw new Error(`Unrecognized container format "${container.format}" (this script knows ${SUPPORTED_FORMAT}). Check FORMAT.md for the format history.`);
  }

  if (container.protection === 'none') return container.data;
  if (container.protection !== 'passphrase') {
    throw new Error(`Unrecognized protection mode "${container.protection}".`);
  }

  if (!passphrase) {
    const labels = (container.slots || []).map((s) => s.label || '(unlabeled)').join(', ');
    throw new Error(`This plan is passphrase-protected. Pass --passphrase. Slots on this file: ${labels}`);
  }

  const errors = [];
  for (const slot of container.slots || []) {
    try {
      const masterKey = await unwrapMasterKey(slot, passphrase, container.planId);
      return await decryptData(container, masterKey);
    } catch (err) {
      errors.push(`${slot.label || slot.id}: ${err.message || err}`);
    }
  }
  throw new Error('That passphrase did not unlock any slot on this file.\n' + errors.map((e) => `  - ${e}`).join('\n'));
}

function parseArgs(argv) {
  const args = { file: null, passphrase: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--passphrase' || a === '-p') args.passphrase = argv[++i];
    else if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--help' || a === '-h') { args.help = true; }
    else if (!args.file) args.file = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.error('Usage: node recover.js PLAN.html [--passphrase "..."] [-o lifepackage.json]');
    process.exit(args.help ? 0 : 1);
  }

  try {
    const html = readFileSync(args.file, 'utf8');
    const container = extractContainer(html);
    const data = await recover(container, args.passphrase);
    const out = JSON.stringify(data, null, 2) + '\n';
    if (args.output) {
      writeFileSync(args.output, out);
      console.error(`Wrote ${args.output}`);
    } else {
      process.stdout.write(out);
    }
  } catch (err) {
    console.error(`Could not recover this plan: ${err.message || err}`);
    process.exit(1);
  }
}

main();
