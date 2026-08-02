/*
  Builds the plan .html file itself — the container described in FORMAT.md's
  "Container Format v1": a static front door, a data island, and the same
  embedded app bundle the reader export already produces. This is what the
  app's file-autosave (see store.svelte.js) writes into the user's chosen
  file, and what "Make a copy" / homing will hand to a file picker or a
  download.
*/

import { readerTemplateRoot, stripUnusedFonts, fontsToKeep, blobToB64 } from './export.js';
import { encryptContainerData } from './slotcrypto.js';
import RECOVER_JS_SOURCE from '../../recover.js?raw';

export const CONTAINER_FORMAT = 'lifepackage-plan/v1';
export const CONTAINER_FORMAT_VERSION = 1;

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

/** Assemble the container-v1 JSON: plan data plus every attachment blob,
 *  base64-encoded and merged into `data.attachmentBlobs` so they inherit
 *  whatever protection the rest of `data` has. `protection = null` builds
 *  today's plaintext shape; `{ masterKeyRaw, slots }` encrypts `data` under
 *  the master key and lists the slots instead — see slotcrypto.js. */
export async function buildContainer({ planId, revision, data, blobs = new Map(), protection = null }) {
  const attachmentBlobs = {};
  for (const att of data.attachments || []) {
    const blob = blobs.get(att.id);
    if (blob) attachmentBlobs[att.id] = await blobToB64(blob, att);
  }
  const dataObj = { ...data, attachmentBlobs };
  const base = {
    format: CONTAINER_FORMAT,
    formatVersion: CONTAINER_FORMAT_VERSION,
    planId,
    revision,
    updated: new Date().toISOString()
  };
  if (!protection) {
    return { ...base, protection: 'none', title: data.package?.title || 'Untitled Plan', data: dataObj };
  }
  const { iv, data: cipherData } = await encryptContainerData({
    masterKeyRaw: protection.masterKeyRaw, planId, revision, dataObj
  });
  return {
    ...base,
    protection: 'passphrase',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    title: data.package?.title || 'Untitled Plan',
    slots: protection.slots,
    iv,
    data: cipherData
  };
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
