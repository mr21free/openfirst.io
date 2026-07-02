/*
  Load an inheritance package from the user's disk — entirely in the browser,
  nothing uploaded. Returns the raw { data, attachmentUrls, blobs } so the store
  can own the editable data and the read-only InheritancePackage view.

  Supports a single inheritance.json, a whole package folder, or a .zip.
  Plus the bundled demo sample (works offline in the single-file build).
*/

import { unzipSync } from 'fflate';
import { isEncryptedEnvelope, decryptEnvelope } from './crypto.js';
import { validatePackage } from './validate.js';

import sampleData from '../sample/inheritance.json';

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

function findSourceBase(paths) {
  const candidates = paths.filter((p) => /(^|\/)inheritance\.json$/i.test(p));
  if (!candidates.length) return [null, ''];
  candidates.sort((a, b) => a.split('/').length - b.split('/').length);
  const src = candidates[0];
  return [src, src.replace(/inheritance\.json$/i, '')];
}

// fileMap: Map<relpath, () => Blob>. Resolve attachment blobs + object URLs.
function buildLoaded(data, fileMap, base) {
  normalizeAttachmentLinks(data);
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

  if (files.length === 1 && /\.html?$/i.test(files[0].name)) {
    return loadFromReaderHtml(await files[0].text());
  }
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return loadFromZip(await files[0].arrayBuffer());
  }
  if (files.length === 1 && /\.json$/i.test(files[0].name)) {
    let obj;
    try { obj = JSON.parse(await files[0].text()); }
    catch { throw new Error('That file is not valid JSON.'); }
    if (isEncryptedEnvelope(obj)) return needsPassword(obj);
    normalizeAttachmentLinks(obj);
    const problems = validatePackage(obj);
    if (problems.length) {
      const shown = problems.slice(0, 12).map((p) => '• ' + p).join('\n');
      const more = problems.length > 12 ? `\n• …and ${problems.length - 12} more` : '';
      throw new Error('This plan can’t be imported — fix these and try again:\n' + shown + more);
    }
    return { data: obj, attachmentUrls: {}, blobs: new Map() };
  }

  const paths = files.map((f) => f.webkitRelativePath || f.name);
  const [src, base] = findSourceBase(paths);
  if (!src) throw new Error('Could not find "inheritance.json" in the dropped files.');

  const byPath = new Map();
  files.forEach((f, i) => byPath.set(norm(paths[i]), f));
  const data = JSON.parse(await byPath.get(norm(src)).text());

  const fileMap = new Map();
  for (const [rel, file] of byPath) fileMap.set(rel, () => file); // File is a Blob
  return buildLoaded(data, fileMap, base);
}

export function loadFromZip(arrayBuffer) {
  const entries = unzipSync(new Uint8Array(arrayBuffer));
  const paths = Object.keys(entries);
  const [src, base] = findSourceBase(paths);
  if (!src) throw new Error('Could not find "inheritance.json" inside the zip.');

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

// ---- Recover an editable plan from a heir reader (start-here.html) ----
// The reader embeds the published plan as `window.__LIFE_PACKAGE__` (the export
// escapes every "<" as <, so the embedded JSON is the only thing before the
// next </script>). Recovers everything the reader holds — i.e. all but drafts.

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || '' });
}

const notReader = () => new Error('This file isn’t a Life Plan reader. Pick a start-here.html exported from this app.');

/** Pull the `window.__LIFE_PACKAGE__` payload out of a reader's HTML text. */
export function extractReaderPayload(htmlText) {
  const m = /window\.__LIFE_PACKAGE__\s*=\s*(\{[\s\S]*?)<\/script>/.exec(htmlText || '');
  if (!m) throw notReader();
  let payload;
  try { payload = JSON.parse(m[1].trim().replace(/;$/, '').trim()); }
  catch { throw new Error('This reader file looks corrupted — its embedded plan couldn’t be read.'); }
  if (!payload || !payload.reader) throw notReader();
  return payload;
}

/** Load a heir reader (.html) back as an editable plan (drafts are not included). */
export function loadFromReaderHtml(htmlText) {
  const payload = extractReaderPayload(htmlText);
  // Password-protected reader: hand the envelope to the same unlock flow as .json.
  if (payload.encrypted) return needsPassword(payload.encrypted);
  const data = payload.data;
  if (!data) throw new Error('This reader has no plan to recover.');
  normalizeAttachmentLinks(data);

  const problems = validatePackage(data);
  if (problems.length) {
    const shown = problems.slice(0, 12).map((p) => '• ' + p).join('\n');
    const more = problems.length > 12 ? `\n• …and ${problems.length - 12} more` : '';
    throw new Error('This plan can’t be imported — fix these and try again:\n' + shown + more);
  }

  const attachmentUrls = {};
  const blobs = new Map();
  for (const [id, a] of Object.entries(payload.attachments || {})) {
    if (!a?.b64) continue;
    const blob = b64ToBlob(a.b64, a.mime || mimeForAttachment(data.attachments?.find((att) => att.id === id)));
    blobs.set(id, blob);
    attachmentUrls[id] = URL.createObjectURL(blob);
  }
  return { data, attachmentUrls, blobs, fromReader: true };
}

export async function loadSample() {
  const data = normalizeAttachmentLinks(JSON.parse(JSON.stringify(sampleData)));
  return { data, attachmentUrls: {}, blobs: new Map() };
}
