/*
  Export the working plan to a durable, on-disk package — a .zip the Reader can
  open again (and that's readable without the app: plain JSON + Markdown + files).
  Built entirely in the browser with fflate; nothing is uploaded.
*/

import { zipSync, strToU8 } from 'fflate';
import { encryptToEnvelope } from './crypto.js';

function slugDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Heir-facing view of the plan: drop every guide flagged `draft`, and any guide
 * group left with no published guides. The owner's working copy is untouched;
 * this only shapes what gets exported.
 */
function publishedOnly(data) {
  const guides = (data.guides || []).filter((g) => !g.draft);
  const usedGroups = new Set(guides.map((g) => g.group).filter(Boolean));
  const guide_groups = (data.guide_groups || []).filter((g) => usedGroups.has(g.id));
  const {
    readiness_checks: _checks,
    readiness_runs: _runs,
    ...rest
  } = data || {};
  return { ...rest, guides, guide_groups };
}

/** How many guides would be withheld from an heir export (for owner messaging). */
export function draftCount(data) {
  return (data?.guides || []).filter((g) => g.draft).length;
}

function packageFolderName(data, name) {
  const t = (name || data.package?.title || 'inheritance-plan').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `${t || 'inheritance-plan'}_${slugDate()}`;
}

function startHereText(data) {
  const title = data.package?.title || 'an inheritance plan';
  return [
    'START HERE',
    '==========',
    '',
    `This folder is ${title}. Take your time. There is no rush.`,
    '',
    'Read it without any app: open the guides in this package as plain text.',
    'Or open it with the Life Package reader and drop this folder / the .zip in.',
    '',
    'The machine-readable source of truth is "inheritance.json" (open format,',
    'schema: inheritance-package/v1), so this plan stays readable for many years.',
    '',
    `Last updated: ${data.package?.updated || slugDate()}`,
    ''
  ].join('\n');
}

function manifest(data) {
  return {
    schema: 'inheritance-package/v1',
    package_id: data.package?.id,
    title: data.package?.title,
    updated: data.package?.updated,
    languages: data.package?.languages,
    default_language: data.package?.default_language,
    generator: 'Life Package (editor export)',
    files: { source: 'inheritance.json', human_entry: 'START_HERE.txt', attachments_dir: 'attachments/' }
  };
}

/** Build the package as a zip Uint8Array. `blobs` is Map<attachmentId, Blob>. */
export async function buildPackageZip(data, blobs, name) {
  const root = packageFolderName(data, name);
  const files = {};
  files[`${root}/inheritance.json`] = strToU8(JSON.stringify(data, null, 2) + '\n');
  files[`${root}/START_HERE.txt`] = strToU8(startHereText(data));
  files[`${root}/manifest.json`] = strToU8(JSON.stringify(manifest(data), null, 2) + '\n');

  for (const att of data.attachments || []) {
    const blob = blobs.get(att.id);
    if (!blob || !att.path) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files[`${root}/${att.path.replace(/^\.?\//, '')}`] = bytes;
  }
  return { zip: zipSync(files, { level: 6 }), name: `${root}.zip` };
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportPackageZip(data, blobs, name) {
  const built = await buildPackageZip(data, blobs, name);
  triggerDownload(new Blob([built.zip], { type: 'application/zip' }), built.name);
}

/** Export password-protected: the package .zip encrypted into our open envelope
 *  (inheritance-encrypted/v1) — which the Reader can unlock with the password. */
export async function exportEncryptedPackage(data, blobs, password, hint = '', name) {
  const { zip } = await buildPackageZip(data, blobs, name);
  const envelope = await encryptToEnvelope(zip, password, { hint });
  const fileName = `${packageFolderName(data, name)}.encrypted.json`;
  triggerDownload(new Blob([JSON.stringify(envelope, null, 2) + '\n'], { type: 'application/json' }), fileName);
}

// ---- Self-contained reader (one .html the heir just double-clicks) ----

function b64FromBytes(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

function mimeForAttachment(att) {
  const explicit = String(att?.mime || '').trim();
  if (explicit.includes('/')) return explicit;
  const name = `${att?.original_filename || ''} ${att?.path || ''} ${att?.filename || ''}`.toLowerCase();
  if (/\.mp4\b/.test(name)) return 'video/mp4';
  if (/\.png\b/.test(name)) return 'image/png';
  if (/\.jpe?g\b/.test(name)) return 'image/jpeg';
  if (/\.webp\b/.test(name)) return 'image/webp';
  if (/\.gif\b/.test(name)) return 'image/gif';
  if (/\.pdf\b/.test(name)) return 'application/pdf';
  return explicit;
}

async function blobToB64(blob, att = null) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { mime: blob.type || mimeForAttachment(att) || '', b64: b64FromBytes(bytes) };
}

// reading_font choice → bundled @font-face family name. Mono is also the app's
// UI face, so it is always kept.
const READING_FONT_FAMILY = {
  mono: 'IBM Plex Mono', sans: 'IBM Plex Sans', inter: 'Inter',
  atkinson: 'Atkinson Hyperlegible', serif: 'Source Serif 4', literata: 'Literata', lora: 'Lora'
};

/** Which font families the heir reader actually needs: the UI mono face, plus
 *  the plan's chosen guide font. Everything else can be dropped from the export. */
function fontsToKeep(data) {
  const keep = new Set(['IBM Plex Mono']); // app/UI font — always present
  const fam = READING_FONT_FAMILY[data?.package?.reading_font];
  if (fam) keep.add(fam);
  return keep;
}

/** Drop @font-face blocks (and their inlined base64) for families the heir
 *  doesn't use — the read-only export carries only the fonts it renders. */
function stripUnusedFonts(docEl, keep) {
  for (const style of docEl.querySelectorAll('style')) {
    const css = style.textContent;
    if (!css || !css.includes('@font-face')) continue;
    // Base64 src data has no '}', so each @font-face block is brace-balanced.
    const next = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
      const m = /font-family\s*:\s*["']?([^"';}]+)["']?/.exec(block);
      return keep.has((m ? m[1] : '').trim()) ? block : '';
    });
    if (next !== css) style.textContent = next;
  }
}

/** Clone the currently-running reader HTML and inject the package payload so the
 *  file boots straight into a read-only reader. Everything is already inlined. */
function buildReaderHtml(payload, keepFonts = null) {
  const docEl = document.documentElement.cloneNode(true);
  docEl.removeAttribute('data-theme'); // let the embedded plan's theme decide
  if (keepFonts) stripUnusedFonts(docEl, keepFonts);
  // A self-contained reader needs everything inlined. In the dev server the app
  // is loaded over the network (/@vite/client, /src/main.js) and would open to a
  // blank page — only the production build inlines the bundle.
  if (docEl.querySelector('script[src]')) {
    throw new Error('Create the heir reader from the built app (run “npm run build”, then open dist/index.html), not the dev server.');
  }
  const app = docEl.querySelector('#app');
  if (app) app.innerHTML = ''; // boot fresh, not from the current render
  // Favicon links point at paths that don't exist beside a standalone file.
  docEl.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());
  const head = docEl.querySelector('head');
  const json = JSON.stringify(payload).replace(/</g, '\\u003c'); // stay inside the <script> tag
  const s = document.createElement('script');
  s.textContent = `window.__LIFE_PACKAGE__=${json};`;
  head.insertBefore(s, head.firstChild);
  return '<!doctype html>\n' + docEl.outerHTML;
}

/**
 * Export a single, self-contained `start-here.html` for the heir: the reader
 * with the plan baked in, read-only. If `password` is given, the embedded plan
 * is the encrypted envelope and the heir unlocks it on open.
 */
export async function exportSelfContainedReader(data, blobs, { password = '', hint = '', name } = {}) {
  // The heir reader (.html) is the published view: draft guides are dropped here
  // only. The .zip and encrypted .json exports keep everything (owner's record).
  const heir = publishedOnly(data);
  let payload;
  if (password) {
    const { zip } = await buildPackageZip(heir, blobs, name);
    const envelope = await encryptToEnvelope(zip, password, { hint });
    payload = { reader: true, v: 1, encrypted: envelope };
  } else {
    const out = name && heir.package ? { ...heir, package: { ...heir.package, title: name } } : heir;
    const attachments = {};
    for (const att of out.attachments || []) {
      const blob = blobs.get(att.id);
      if (blob) attachments[att.id] = await blobToB64(blob, att);
    }
    payload = { reader: true, v: 1, data: out, attachments };
  }
  // Bundle only the fonts the heir reader renders (UI mono + the chosen guide
  // font) — computed from the original data even when the payload is encrypted.
  const html = buildReaderHtml(payload, fontsToKeep(data));
  triggerDownload(new Blob([html], { type: 'text/html' }), 'start-here.html');
}

/** Export just the JSON source (no attachments) — quick backup. */
export function exportJson(data) {
  const name = `${packageFolderName(data)}.inheritance.json`;
  triggerDownload(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }), name);
}
