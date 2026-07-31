/*
  Shared helpers for building the plan file — used by planfile.js when it
  writes the container-v1 .html (both live autosave and the front door).
*/

export function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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

export async function blobToB64(blob, att = null) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { mime: blob.type || mimeForAttachment(att) || '', b64: b64FromBytes(bytes) };
}

// reading_font choice → bundled @font-face family name. Plex Sans (the UI's
// human voice) and Plex Mono (its machine voice) are always kept.
const READING_FONT_FAMILY = {
  mono: 'IBM Plex Mono', sans: 'IBM Plex Sans', inter: 'Inter',
  atkinson: 'Atkinson Hyperlegible', serif: 'Source Serif 4', literata: 'Literata', lora: 'Lora'
};

/** Which font families the reader actually needs: the two UI faces, plus
 *  the plan's chosen guide font. Everything else can be dropped from the file. */
export function fontsToKeep(data) {
  const keep = new Set(['IBM Plex Mono', 'IBM Plex Sans']); // UI voices — always present
  const fam = READING_FONT_FAMILY[data?.package?.reading_font];
  if (fam) keep.add(fam);
  return keep;
}

/** Drop @font-face blocks (and their inlined base64) for families the plan
 *  doesn't use — the file carries only the fonts it renders. */
export function stripUnusedFonts(docEl, keep) {
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

/** The plan file needs a fully inlined page to clone. In production the
 *  running page already is that (everything bundled by viteSingleFile).
 *  In dev, the page is loaded over the network (/@vite/client, /src/main.js)
 *  and can't stand alone — fetch a real in-memory production build from the
 *  dev server instead (see `readerTemplateDevServer` in vite.config.js) so
 *  the file builds out of the box without a manual `npm run build`. */
export async function readerTemplateRoot() {
  if (!document.querySelector('script[src]')) return document.documentElement;
  const res = await fetch('/__reader-template.html');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not build the plan file (dev server): ${detail || res.statusText}`);
  }
  return new DOMParser().parseFromString(await res.text(), 'text/html').documentElement;
}
