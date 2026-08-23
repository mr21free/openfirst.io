// Regenerates the format-v2 fixtures using the exact same primitives the app
// uses in the browser (WebCrypto's crypto.subtle, available as a Node global
// since Node 19). Run with: node generate.mjs
//
// Format v2 only changes *protected* containers (see FORMAT.md, "Container
// Format v2"): the plan JSON is encrypted exactly as v1 did, but each
// attachment is now encrypted independently into a top-level `attachments`
// map instead of being embedded in that same blob. There is no v2
// "unprotected" shape — an unprotected save always writes Format v1 (see
// buildContainer in planfile.js), so that case is already covered by
// format-v1/plain.html and isn't duplicated here.
//
// These fixtures are permanent test material for FORMAT.md / recover.py:
// once committed, a given fixture's bytes never change, so the format's
// decode path can always be tested against everything it has ever had to
// open. If you need a *new* scenario, add a new fixture file — don't edit an
// existing one.

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
// against what's committed — see format-v2.yml), so salts/IVs/keys come from
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
const rng = makeSeededRng(0x0f2cf2de);
function detRandomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

// One real attachment, deliberately unlike format-v1's SAMPLE_PACKAGE (which
// has none) — this is what exercises the new per-attachment encrypt/decrypt
// path and the `attachments` map, not just the unchanged plan-data path.
const ATTACHMENT_ID = 'att_letter';
const ATTACHMENT_CONTENT = 'This is a sample attachment used only by the format-v2 fixtures.\n';
const ATTACHMENT_BYTES = ENC.encode(ATTACHMENT_CONTENT);
const ATTACHMENT_MIME = 'text/plain';

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
    }
  ],
  folders: [],
  attachments: [
    {
      id: ATTACHMENT_ID,
      filename: 'letter.txt',
      path: '/attachments/letter.txt',
      mime: ATTACHMENT_MIME,
      description: 'A short note kept as a sample attachment.',
      item_id: 'item_passport'
    }
  ],
  readiness_checks: [],
  readiness_runs: []
};

// The canonical recovered shape: recover.js/recover.py decrypt the
// `attachments` bucket and merge it back into `data.attachmentBlobs`, so the
// printed JSON looks the same regardless of which format version the file
// happens to be in (see decryptData in recover.js).
const EXPECTED_RECOVERED = {
  ...SAMPLE_PACKAGE,
  attachmentBlobs: {
    [ATTACHMENT_ID]: { mime: ATTACHMENT_MIME, b64: Buffer.from(ATTACHMENT_BYTES).toString('base64') }
  }
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

// Deliberately NOT bound to `revision` — see slotcrypto.js's aadAttachment
// and FORMAT.md. Mirrored here byte-for-byte so these fixtures are only
// decryptable exactly the way the real app / recover.js / recover.py do it.
function aadAttachment(planId, attachmentId) {
  return ENC.encode(`lifepackage-plan-attachment-aad/${AAD_VERSION}\n${planId}\n${attachmentId}`);
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

async function encryptAttachment(planId, masterKey) {
  const iv = detRandomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadAttachment(planId, ATTACHMENT_ID) },
    masterKey,
    ATTACHMENT_BYTES
  );
  return { [ATTACHMENT_ID]: { iv: b64(iv), mime: ATTACHMENT_MIME, data: b64(ciphertext) } };
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

async function buildSingleSlot() {
  const planId = 'plan_fixture_v2_single_slot';
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
  const attachments = await encryptAttachment(planId, masterKey);

  const container = {
    format: 'lifepackage-plan/v1',
    formatVersion: 2,
    planId,
    revision,
    updated: '2026-07-27T15:00:00Z',
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title: SAMPLE_PACKAGE.package.title,
    slots: [slot],
    iv: b64(iv),
    data: b64(ciphertext),
    attachments
  };
  writeFileSync(join(HERE, 'single-slot.html'), frontDoorHtml(container));
}

async function buildMultiSlot() {
  const planId = 'plan_fixture_v2_multi_slot';
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
  const attachments = await encryptAttachment(planId, masterKey);

  const container = {
    format: 'lifepackage-plan/v1',
    formatVersion: 2,
    planId,
    revision,
    updated: '2026-07-27T15:10:00Z',
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title: SAMPLE_PACKAGE.package.title,
    slots: [slotSarah, slotLawyer],
    iv: b64(iv),
    data: b64(ciphertext),
    attachments
  };
  writeFileSync(join(HERE, 'multi-slot.html'), frontDoorHtml(container));
}

const manifest = {
  format: 'lifepackage-plan/v1',
  formatVersion: 2,
  reference: 'expected.json',
  fixtures: [
    {
      file: 'single-slot.html',
      protection: 'passphrase',
      planId: 'plan_fixture_v2_single_slot',
      revision: 5,
      slots: [{ label: 'Owner', passphrase: 'correct horse battery staple' }]
    },
    {
      file: 'multi-slot.html',
      protection: 'passphrase',
      planId: 'plan_fixture_v2_multi_slot',
      revision: 12,
      slots: [
        { label: 'Sarah', passphrase: 'sarah-passphrase-example' },
        { label: 'Lawyer', passphrase: 'lawyer-passphrase-example' }
      ]
    }
  ]
};

await buildSingleSlot();
await buildMultiSlot();
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(HERE, 'expected.json'), JSON.stringify(EXPECTED_RECOVERED, null, 2) + '\n');
console.log('Wrote single-slot.html, multi-slot.html, manifest.json, expected.json');
