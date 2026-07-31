/*
  Load a life package from the user's disk — entirely in the browser,
  nothing uploaded. Returns the raw { data, attachmentUrls, blobs } so the store
  can own the editable data and the read-only InheritancePackage view.

  Supports a single lifepackage.json, or a .zip package (kept temporarily for
  backward compatibility with older exports — see CHANGES.md).
  Legacy inheritance.json packages are still accepted.
  Plus the bundled demo sample (works offline in the single-file build).
*/

import { unzipSync } from 'fflate';
import { isEncryptedEnvelope, decryptEnvelope } from './crypto.js';
import { validatePackage } from './validate.js';
import { SOURCE_FILE, SOURCE_FILES, isSourceFile, sourceBase, sourceFileRank, normalizePackageFormat } from './format.js';

import sampleData from '../sample/lifepackage.json';

const norm = (p) => (p || '').replace(/^\.?\//, '');

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

function typedBlob(blob, att) {
  const mime = mimeForAttachment(att);
  if (!blob || blob.type || !mime) return blob;
  return blob.slice(0, blob.size, mime);
}

// Normalize item<->attachment links to ONE canonical direction: attachment.item_ids.
// Some plans stored links the other way (item.attachment_ids); fold those in so the
// item form, the file form, and the heir view all show the same set. No link is lost
// — only its storage side is unified.
function normalizeAttachmentLinks(data) {
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.attachments)) return data;
  const byId = new Map(data.attachments.map((a) => [a.id, a]));
  for (const it of data.items) {
    if (!Array.isArray(it.attachment_ids) || !it.attachment_ids.length) continue;
    for (const aid of it.attachment_ids) {
      const a = byId.get(aid);
      if (!a) continue;
      if (!Array.isArray(a.item_ids)) a.item_ids = [];
      if (!a.item_ids.includes(it.id)) a.item_ids.push(it.id);
    }
    delete it.attachment_ids;
  }
  return data;
}

// Raw secrets are not supported: the plan is a map, not a vault. Older plans
// could carry `item.secret = { kind, value, note }` — strip it on load so a
// forgotten secret can never ride invisibly into a new export or the heir
// reader. (The boolean `sensitive` badge is kept — it holds no secret.)
function stripRawSecrets(data) {
  if (!data || !Array.isArray(data.items)) return data;
  let stripped = 0;
  for (const it of data.items) {
    if (it && typeof it === 'object' && 'secret' in it) { delete it.secret; stripped++; }
  }
  if (stripped) {
    console.warn(`OpenFirst: removed ${stripped} stored raw secret(s) — this plan format no longer carries secrets. Keep secrets outside the plan and describe where to find them.`);
  }
  return data;
}

function findSourceBase(paths) {
  const candidates = paths.filter(isSourceFile);
  if (!candidates.length) return [null, ''];
  candidates.sort((a, b) => sourceFileRank(a) - sourceFileRank(b) || a.split('/').length - b.split('/').length);
  const src = candidates[0];
  return [src, sourceBase(src)];
}

// fileMap: Map<relpath, () => Blob>. Resolve attachment blobs + object URLs.
function buildLoaded(data, fileMap, base) {
  normalizeAttachmentLinks(data);
  normalizePackageFormat(data);
  stripRawSecrets(data);
  const attachmentUrls = {};
  const blobs = new Map();
  for (const att of data.attachments || []) {
    let getter = fileMap.get(norm(base + att.path));
    if (!getter) {
      for (const [rel, g] of fileMap) {
        if (norm(rel).endsWith(norm(att.path))) { getter = g; break; }
      }
    }
    if (getter) {
      const blob = typedBlob(getter(), att);
      blobs.set(att.id, blob);
      attachmentUrls[att.id] = URL.createObjectURL(blob);
    }
  }
  return { data, attachmentUrls, blobs };
}

// A load blocked on a password. Landing reacts to `__encrypted`.
const needsPassword = (envelope) => ({ __encrypted: true, envelope });

export async function loadFromFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) throw new Error('No files selected.');

  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return loadFromZip(await files[0].arrayBuffer());
  }
  if (files.length === 1 && /\.json$/i.test(files[0].name)) {
    let obj;
    try { obj = JSON.parse(await files[0].text()); }
    catch { throw new Error('That file is not valid JSON.'); }
    if (isEncryptedEnvelope(obj)) return needsPassword(obj);
    normalizeAttachmentLinks(obj);
    stripRawSecrets(obj);
    const problems = validatePackage(obj);
    if (problems.length) {
      const shown = problems.slice(0, 12).map((p) => '• ' + p).join('\n');
      const more = problems.length > 12 ? `\n• …and ${problems.length - 12} more` : '';
      throw new Error('This plan can’t be imported — fix these and try again:\n' + shown + more);
    }
    normalizePackageFormat(obj);
    return { data: obj, attachmentUrls: {}, blobs: new Map() };
  }

  throw new Error('Pick a plan .json or .zip package.');
}

export function loadFromZip(arrayBuffer) {
  const entries = unzipSync(new Uint8Array(arrayBuffer));
  const paths = Object.keys(entries);
  const [src, base] = findSourceBase(paths);
  if (!src) throw new Error(`Could not find "${SOURCE_FILE}" inside the zip. Legacy "${SOURCE_FILES[1]}" is also supported.`);

  const data = JSON.parse(new TextDecoder().decode(entries[src]));
  const fileMap = new Map();
  for (const p of paths) fileMap.set(norm(p), () => new Blob([entries[p]]));
  return buildLoaded(data, fileMap, base);
}

/** Decrypt a password-protected envelope (plaintext is the package .zip) and load it. */
export async function decryptAndLoad(envelope, password) {
  const zipBytes = await decryptEnvelope(envelope, password);
  return loadFromZip(zipBytes.buffer);
}

export async function loadSample() {
  const data = normalizePackageFormat(normalizeAttachmentLinks(JSON.parse(JSON.stringify(sampleData))));
  return { data, attachmentUrls: {}, blobs: new Map() };
}
