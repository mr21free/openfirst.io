// Regenerates the format-v1 fixtures using the exact same primitives the app
// uses in the browser (WebCrypto's crypto.subtle, available as a Node global
// since Node 19). Run with: node generate.mjs
//
// These fixtures are permanent test material for FORMAT.md / recover.py: once
// committed, a given fixture's bytes never change, so the format's decode
// path can always be tested against everything it has ever had to open. If
// you need a *new* scenario, add a new fixture file — don't edit an existing
// one.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECOVER_JS_SOURCE = readFileSync(join(HERE, '..', '..', '..', 'recover.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const ENC = new TextEncoder();
const ITERATIONS = 600000;
const AAD_VERSION = 'v1';

// Fixtures must be byte-identical across runs (CI regenerates them and diffs
// against what's committed — see format-v1.yml), so salts/IVs/keys come from
// a seeded PRNG rather than real crypto.getRandomValues. Only fixture inputs
// are deterministic; the actual encrypt/decrypt still goes through real
// crypto.subtle.
function makeSeededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeSeededRng(0x0f1cf1de);
function detRandomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

const SAMPLE_PACKAGE = {
  schema: 'lifepackage/v1',
  package: {
    id: 'pkg_sample',
    title: 'Sample Family Plan',
    owner_id: 'per_owner',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-07-27T14:32:00Z',
    languages: ['en'],
    default_language: 'en',
    primary_person_ids: ['per_heir']
  },
  roles: [
    { id: 'owner', name: 'Owner' },
    { id: 'primary_heir', name: 'Primary heir' }
  ],
  people: [
    { id: 'per_owner', name: 'Miro', roles: ['owner'] },
    { id: 'per_heir', name: 'Sarah', roles: ['primary_heir'] }
  ],
  locations: [
    { id: 'loc_home_safe', name: 'Home safe', order: 0 }
  ],
  items: [
    {
      id: 'item_passport',
      name: 'Passport',
      importance: 'high',
      location_ids: ['loc_home_safe'],
      access_person_ids: ['per_heir']
    }
  ],
  guides: [
    {
      id: 'guide_start',
      title: 'Start here',
      order: 0,
      audience_person_ids: ['per_heir'],
      content: { en: '## Start here\n\nRead this first.' }
    },
    {
      id: 'guide_draft_note',
      title: 'Unfinished note (draft)',
      order: 1,
      draft: true,
      audience_person_ids: ['per_heir'],
      content: { en: 'Still being written — not ready to show yet.' }
    }
  ],
  folders: [],
  attachments: [],
  readiness_checks: [],
  readiness_runs: []
};

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

function aadMain(planId, revision) {
  return ENC.encode(`lifepackage-plan-aad/${AAD_VERSION}\n${planId}\n${revision}`);
}

function aadSlot(planId, slotId, label, hint) {
  return ENC.encode(`lifepackage-plan-slot-aad/${AAD_VERSION}\n${planId}\n${slotId}\n${label}\n${hint || ''}`);
}

async function deriveKey(passphrase, salt, iterations, usage) {
  const material = await crypto.subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    usage
  );
}

async function makeSlot(passphrase, label, hint, slotId, planId, masterKeyRaw) {
  const salt = detRandomBytes(16);
  const iv = detRandomBytes(12);
  const key = await deriveKey(passphrase, salt, ITERATIONS, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadSlot(planId, slotId, label, hint) },
    key,
    masterKeyRaw
  );
  return {
    id: slotId,
    label,
    hint,
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    wrappedKey: b64(wrapped)
  };
}

function frontDoorHtml(container) {
  const slotsHtml = container.protection === 'passphrase'
    ? `<ul>${container.slots.map((s) =>
        `<li>${s.label}${s.hint ? ` — hint: ${s.hint}` : ''}</li>`).join('')}</ul>`
    : `<p>No passphrase — this file opens for anyone who has it.</p>`;
  return `<!doctype html>
<!--
  This is an OpenFirst plan file. To read it without OpenFirst: open this
  file in a text editor, find the recovery script marker further down (view
  source, then search for OPENFIRST-RECOVERY-SCRIPT), copy everything below
  that marker up to the closing tag into a new file named recover.js, then
  run: node recover.js THIS-FILE.html
-->
<html>
<head>
<meta charset="utf-8">
<title>${container.title}</title>
</head>
<body>
<div id="openfirst-front-door">
  <p>OpenFirst plan file — container format v${container.formatVersion} (${container.format})</p>
  <p>Plan id: ${container.planId} — revision ${container.revision} — last saved ${container.updated}</p>
  ${slotsHtml}
</div>
<script type="application/json" id="openfirst-plan-data">${JSON.stringify(container)}</script>
<!-- OPENFIRST-RECOVERY-SCRIPT: everything in the next tag is recover.js, verbatim -->
<script type="text/plain" id="openfirst-recover-js">${RECOVER_JS_SOURCE}</script>
<!-- The real exported file also inlines the full app bundle here, which reads
     #openfirst-plan-data and renders the interactive viewer/editor. Omitted
     from this fixture: it isolates the container format from the app build. -->
</body>
</html>
`;
}

async function buildPlain() {
  const container = {
    format: 'lifepackage-plan/v1',
    formatVersion: 1,
    planId: 'plan_fixture_plain',
    revision: 3,
    updated: '2026-07-27T14:32:00Z',
    protection: 'none',
    title: SAMPLE_PACKAGE.package.title,
    data: SAMPLE_PACKAGE
  };
  writeFileSync(join(HERE, 'plain.html'), frontDoorHtml(container));
}

async function buildSingleSlot() {
  const planId = 'plan_fixture_single_slot';
  const revision = 5;
  const masterKeyRaw = detRandomBytes(32);
  const masterKey = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['encrypt']);

  const slot = await makeSlot('correct horse battery staple', 'Owner', 'the diceware phrase from the safe', 'slot_owner', planId, masterKeyRaw);

  const iv = detRandomBytes(12);
  const plaintext = ENC.encode(JSON.stringify(SAMPLE_PACKAGE));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadMain(planId, revision) },
    masterKey,
    plaintext
  );

  const container = {
    format: 'lifepackage-plan/v1',
    formatVersion: 1,
    planId,
    revision,
    updated: '2026-07-27T15:00:00Z',
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title: SAMPLE_PACKAGE.package.title,
    slots: [slot],
    iv: b64(iv),
    data: b64(ciphertext)
  };
  writeFileSync(join(HERE, 'single-slot.html'), frontDoorHtml(container));
}

async function buildMultiSlot() {
  const planId = 'plan_fixture_multi_slot';
  const revision = 12;
  const masterKeyRaw = detRandomBytes(32);
  const masterKey = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', false, ['encrypt']);

  const slotSarah = await makeSlot('sarah-passphrase-example', 'Sarah', 'ask Sarah directly', 'slot_sarah', planId, masterKeyRaw);
  const slotLawyer = await makeSlot('lawyer-passphrase-example', 'Lawyer', 'in our engagement letter', 'slot_lawyer', planId, masterKeyRaw);

  const iv = detRandomBytes(12);
  const plaintext = ENC.encode(JSON.stringify(SAMPLE_PACKAGE));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadMain(planId, revision) },
    masterKey,
    plaintext
  );

  const container = {
    format: 'lifepackage-plan/v1',
    formatVersion: 1,
    planId,
    revision,
    updated: '2026-07-27T15:10:00Z',
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title: SAMPLE_PACKAGE.package.title,
    slots: [slotSarah, slotLawyer],
    iv: b64(iv),
    data: b64(ciphertext)
  };
  writeFileSync(join(HERE, 'multi-slot.html'), frontDoorHtml(container));
}

const manifest = {
  format: 'lifepackage-plan/v1',
  formatVersion: 1,
  fixtures: [
    { file: 'plain.html', protection: 'none', planId: 'plan_fixture_plain', revision: 3 },
    {
      file: 'single-slot.html',
      protection: 'passphrase',
      planId: 'plan_fixture_single_slot',
      revision: 5,
      slots: [{ label: 'Owner', passphrase: 'correct horse battery staple' }]
    },
    {
      file: 'multi-slot.html',
      protection: 'passphrase',
      planId: 'plan_fixture_multi_slot',
      revision: 12,
      slots: [
        { label: 'Sarah', passphrase: 'sarah-passphrase-example' },
        { label: 'Lawyer', passphrase: 'lawyer-passphrase-example' }
      ]
    }
  ]
};

await buildPlain();
await buildSingleSlot();
await buildMultiSlot();
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Wrote plain.html, single-slot.html, multi-slot.html, manifest.json');
