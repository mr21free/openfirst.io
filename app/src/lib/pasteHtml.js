/*
  Converts pasted rich HTML (copied from Word, Google Docs, Notion, Pages,
  browser-rendered PDFs, etc.) into the guide editor's own Markdown subset —
  see markdown.js for exactly what's supported — so formatting survives a
  copy/paste instead of landing as flat plain text.

  Runs on the browser's own DOMParser rather than a bundled dependency: the
  legacy markup real apps emit (Word's "downlevel-revealed" conditional
  comments, mismatched tags, Google Docs' style-only formatting) is exactly
  what a spec-compliant HTML parser already normalizes; hand-rolling a
  tokenizer would mean reimplementing that for no benefit, and pulling in a
  package (e.g. turndown) would break the project's dependency-free stance
  (see the comment at the top of markdown.js).

  What this can't recover: some real-world exports (e.g. macOS `textutil`'s
  docx-to-HTML, or a PDF viewer's clipboard) style headings as a same-tag
  `<p class="p1">` instead of `<h1-6>`, with the only remaining signal being a
  larger `font-size` than the surrounding body text — see headingLevel()/
  computeBodyFontSize() below. When even that's absent (e.g. a PDF copy that
  carries no size info at all, just bare newline-separated text), a heading
  degrades to a plain paragraph rather than being guessed at from its wording.

  A PDF's text layer has no notion of a logical paragraph or list item — a
  viewer's copy (e.g. macOS Preview) extracts one <p> per *visual* line, so a
  wrapped sentence or list item splits across several paragraphs, and a
  bullet glyph lands in its own paragraph ahead of its text. reflowParagraphs()
  below re-joins those after the fact — see its comment for how it tells a
  wrapped line from a deliberate paragraph break.
*/

const SAFE_URL_RE = /^(https?:|mailto:)/i;
function safeUrl(url) {
  const u = (url || '').trim();
  return SAFE_URL_RE.test(u) ? u : null;
}

function styleValue(el, prop) {
  const style = el.getAttribute && el.getAttribute('style');
  if (!style) return null;
  const m = style.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i'));
  return m ? m[1].trim() : null;
}

// Word/Google Docs mark headings with real <h1-6> tags, but exports through
// macOS `textutil` (docx/pages -> HTML) and some PDF copy paths style a
// heading as a same-tag <p>/<div> that's only distinguishable by a larger
// font-size — e.g. textutil emits a document's Title as `<p class="p1">`
// sized via a `p.p1 { font: 12.0px Times }` rule in a <style> block (not an
// inline style attribute), sitting among same-tag `10.5px` body paragraphs.
// Read that size back out — from an inline `font-size`/`font` shorthand
// first, falling back to a stylesheet rule matching the element's class —
// so those can still be promoted to a markdown heading instead of degrading
// to a plain paragraph indistinguishable from the rest of the text.
function extractFontSize(cssText) {
  if (!cssText) return null;
  const m = cssText.match(/font-size\s*:\s*([\d.]+)\s*(px|pt)/i) || cssText.match(/\bfont\s*:\s*[^;{}]*?([\d.]+)\s*(px|pt)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /pt/i.test(m[2]) ? n * (4 / 3) : n;
}

// textutil's <style> rules are always flat, comma/selector-list rules with no
// nesting or media queries (e.g. `p.p1, li.p1 {margin:...; font: 12.0px Times}`)
// — simple enough that a full CSS parser would be overkill.
function parseClassFontSizes(doc) {
  const map = new Map();
  for (const styleEl of doc.querySelectorAll('style')) {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(styleEl.textContent || ''))) {
      const size = extractFontSize(m[2]);
      if (size == null) continue;
      for (const cls of m[1].match(/\.[\w-]+/g) || []) map.set(cls.slice(1), size);
    }
  }
  return map;
}

function ownFontSize(el, classSizes) {
  const inline = extractFontSize(el.getAttribute && el.getAttribute('style'));
  if (inline != null) return inline;
  if (classSizes && el.classList) {
    for (const cls of el.classList) { if (classSizes.has(cls)) return classSizes.get(cls); }
  }
  return null;
}

// Google Docs' real clipboard HTML (unlike textutil's docx export, which
// styles the <p> itself) never puts a font-size on the paragraph — only on
// the inline <span> run(s) inside it, since a paragraph can mix runs of
// different sizes. When the paragraph carries no size of its own, fall back
// to whichever inline run covers the most of its text.
function fontSizePx(el, classSizes) {
  const own = ownFontSize(el, classSizes);
  if (own != null) return own;
  if (!el.querySelectorAll) return null;
  let best = null; let bestLen = 0;
  for (const child of el.querySelectorAll('span,font,b,i,strong,em,u')) {
    const size = ownFontSize(child, classSizes);
    if (size == null) continue;
    const len = (child.textContent || '').trim().length;
    if (len > bestLen) { bestLen = len; best = size; }
  }
  return best;
}

// A document's "body" size is whichever size the most text sits at — anything
// at least that large is a heading candidate (see headingLevel). Quantized to
// the nearest half-pixel rather than a whole pixel: real exports sometimes
// carry sub-pixel gaps (an 11.5px body vs. a 12.0px heading), and rounding
// both to "12" would erase the only distinction between them.
function computeBodyFontSize(root, classSizes) {
  const counts = new Map();
  for (const el of root.querySelectorAll('p,div,li')) {
    if (!el.textContent || !el.textContent.trim()) continue;
    const size = fontSizePx(el, classSizes);
    if (size == null) continue;
    const key = Math.round(size * 2) / 2;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let body = null; let best = 1;
  for (const [size, n] of counts) { if (n > best) { best = n; body = size; } }
  return body;
}

// Headings degrade to plain paragraphs unless the whole document has *some*
// font-size signal to go on (ctx.bodySize != null) — a source with no size
// info anywhere (e.g. a bare PDF-text-layer copy, see the module comment)
// never gets a heading guessed purely from its wording.
//
// The size gap alone isn't always enough to tell a heading from body text:
// a real textutil export can put a document's Title and an ordinary body
// paragraph at the *same* font-size (11.5px body vs. 12px Title — just 4%,
// well within paragraph-to-paragraph jitter). So size only has to be at
// least tied with body; what actually separates a heading from a sentence
// that happens to share that size is shape — short, and not trailing off
// with sentence punctuation the way real prose does.
function headingLevel(el, ctx) {
  if (ctx.bodySize == null) return null;
  const size = fontSizePx(el, ctx.classSizes);
  if (size == null || size < ctx.bodySize - 0.25) return null;
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 60 || /[.,;:!?]$/.test(text)) return null;
  // A stray orphaned quote mark or bullet glyph (both common PDF-copy
  // line-fragmentation artifacts) is short and doesn't end in sentence
  // punctuation either — reject anything without a real word in it.
  if (!/[\p{L}\p{N}]{2,}/u.test(text)) return null;
  return size >= ctx.bodySize * 1.3 ? 1 : 2;
}

// Style always wins over tag when present — Google Docs wraps its whole
// clipboard fragment in `<b id="docs-internal-guid-..." style="font-weight:
// normal">`, a no-op reset, not real bold. A bare tag with no style is the
// common case for most other apps (Word, Notion, Pages, Apple Mail).
function computeBold(el, inherited) {
  const v = styleValue(el, 'font-weight');
  if (v != null) return /^(bold|[6-9]\d\d|1000)$/i.test(v);
  if (el.tagName === 'B' || el.tagName === 'STRONG') return true;
  return inherited;
}
function computeItalic(el, inherited) {
  const v = styleValue(el, 'font-style');
  if (v != null) return /italic|oblique/i.test(v);
  if (el.tagName === 'I' || el.tagName === 'EM') return true;
  return inherited;
}

const normalizeSpace = (s) => s.replace(/ /g, ' ');

// Wraps only the non-whitespace core in emphasis markers, so leading/trailing
// spaces around a bold run don't end up glued to the "**" (which the
// renderer only recognizes when it hugs real content).
function emphasize(text, bold, italic) {
  if (!text) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  let out = core;
  if (bold && italic) out = '**_' + out + '_**';
  else if (bold) out = '**' + out + '**';
  else if (italic) out = '*' + out + '*';
  return lead + out + trail;
}

// Inline walk: real newlines are introduced only by <br> — a text node's own
// whitespace/newlines are source formatting, not intent, and get collapsed.
function inlineText(node, bold, italic, skip) {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (skip && skip.has(child)) continue;
    if (child.nodeType === 3) {
      out += emphasize(normalizeSpace(child.nodeValue).replace(/\s+/g, ' '), bold, italic);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    if (tag === 'BR') { out += '\n'; continue; }
    if (tag === 'CODE') { out += '`' + normalizeSpace(child.textContent).replace(/\s+/g, ' ').trim() + '`'; continue; }
    if (tag === 'A') {
      const href = safeUrl(child.getAttribute('href'));
      const label = inlineText(child, bold, italic, skip).trim();
      out += href && label ? `[${label}](${href})` : (label || normalizeSpace(child.textContent));
      continue;
    }
    out += inlineText(child, computeBold(child, bold), computeItalic(child, italic), skip);
  }
  return out;
}
const paragraphText = (el, skip) => inlineText(el, computeBold(el, false), computeItalic(el, false), skip).trim();
const singleLine = (el, skip) => inlineText(el, computeBold(el, false), computeItalic(el, false), skip).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

// Word's clipboard HTML doesn't use <ul>/<ol> for lists at all — it emits
// flat `<p style="mso-list:l0 level1 lfo1">` paragraphs with the visible
// bullet/number glyph already baked into the text inside a nested
// `mso-list:Ignore` span. Read that glyph back out to tell bullet vs
// numbered, then drop it (we re-add our own marker).
function msoListInfo(el) {
  const style = el.getAttribute && el.getAttribute('style');
  const m = style && style.match(/mso-list\s*:\s*l\d+\s+level(\d+)/i);
  if (!m) return null;
  let ignoreEl = null;
  for (const span of el.querySelectorAll('span')) {
    if (/mso-list\s*:\s*ignore/i.test(span.getAttribute('style') || '')) { ignoreEl = span; break; }
  }
  return { level: +m[1] - 1, ordered: /\d/.test(ignoreEl ? ignoreEl.textContent : ''), ignoreEl };
}

const listPrefix = (ordered, depth, n) => (ordered ? `${n}. ` : `${'-'.repeat(depth + 1)} `);

// Unordered nesting is dash-count based; ordered lists have no nesting
// support at all in markdown.js, so a nested <ol> just continues as its own
// flat, independently-numbered run of lines.
function renderList(el, depth, lines) {
  const ordered = el.tagName === 'OL';
  let n = 0;
  for (const li of Array.from(el.children)) {
    if (li.tagName === 'UL' || li.tagName === 'OL') {
      // Some writers (e.g. Cocoa's HTML exporter) nest a continuation list
      // directly inside another <ul>/<ol>, with no <li> wrapper at all.
      renderList(li, depth + 1, lines);
      continue;
    }
    if (li.tagName !== 'LI') continue;
    n++;
    const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    const skip = nested.length ? new Set(nested) : null;
    const text = singleLine(li, skip);
    lines.push(listPrefix(ordered, depth, n) + text);
    for (const nestedList of nested) renderList(nestedList, depth + 1, lines);
  }
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE']);
const hasBlockChild = (el) => Array.from(el.children || []).some((c) => BLOCK_TAGS.has(c.tagName));

// Each block records whether it's a plain, undecorated paragraph — only
// those are eligible for reflowParagraphs()'s wrapped-line/bullet-marker
// merging. A heading, a real list, an mso-list line, a table, etc. are
// already a single complete logical unit and must never be merged into a
// neighbor just because its text happens to lack trailing punctuation.
function walkBlocks(root, blocks, ctx) {
  for (const node of Array.from(root.childNodes)) walkNode(node, blocks, ctx);
}

function walkNode(node, blocks, ctx) {
  if (node.nodeType === 3) {
    const t = normalizeSpace(node.nodeValue).replace(/\s+/g, ' ').trim();
    if (t) blocks.push({ text: t, plain: false });
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK' || tag === 'HEAD') return;

  const h = /^H([1-6])$/.exec(tag);
  if (h) {
    const text = singleLine(node);
    if (text) blocks.push({ text: '#'.repeat(+h[1]) + ' ' + text, plain: false });
    return;
  }
  if (tag === 'HR') { blocks.push({ text: '---', plain: false }); return; }
  if (tag === 'BR') return;
  if (tag === 'PRE') {
    const code = normalizeSpace(node.textContent).replace(/\n+$/, '');
    blocks.push({ text: '```\n' + code + '\n```', plain: false });
    return;
  }
  if (tag === 'BLOCKQUOTE') {
    const inner = [];
    walkBlocks(node, inner, ctx);
    const joined = inner.map((b) => b.text).join('\n');
    const text = inner.length ? joined.split('\n').map((l) => '> ' + l).join('\n') : singleLine(node);
    if (text.trim()) blocks.push({ text, plain: false });
    return;
  }
  if (tag === 'UL' || tag === 'OL') {
    const lines = [];
    renderList(node, 0, lines);
    if (lines.length) blocks.push({ text: lines.join('\n'), plain: false });
    return;
  }
  if (tag === 'TABLE') {
    // No table syntax in markdown.js — degrade to one plain line per row
    // rather than losing the content.
    const rows = [];
    for (const tr of node.querySelectorAll('tr')) {
      const cells = Array.from(tr.querySelectorAll('td,th')).map((c) => singleLine(c)).filter(Boolean);
      if (cells.length) rows.push(cells.join(' | '));
    }
    if (rows.length) blocks.push({ text: rows.join('\n'), plain: false });
    return;
  }
  const mso = (tag === 'P' || tag === 'DIV') ? msoListInfo(node) : null;
  if (mso) {
    const skip = mso.ignoreEl ? new Set([mso.ignoreEl]) : null;
    const text = singleLine(node, skip);
    // The renderer discards the literal digits in an ordered-list source line
    // (it numbers <li>s itself), so not being able to recover Word's true
    // sequence number here doesn't lose any visible numbering.
    if (text) blocks.push({ text: listPrefix(mso.ordered, mso.level, 1) + text, plain: false });
    return;
  }
  if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
    if (hasBlockChild(node)) { walkBlocks(node, blocks, ctx); return; }
    const level = (tag === 'P' || tag === 'DIV') ? headingLevel(node, ctx) : null;
    const text = paragraphText(node);
    if (text) blocks.push(level ? { text: '#'.repeat(level) + ' ' + text, plain: false } : { text, plain: true });
    return;
  }
  // Unknown/generic wrapper (SPAN, FONT, BODY, or Google Docs' bold reset
  // wrapper) — not a block by itself, so recurse into its children instead
  // of flattening or dropping whatever it wraps.
  walkBlocks(node, blocks, ctx);
}

// Glyphs a PDF viewer's copy commonly emits as a bullet's own standalone
// paragraph, disconnected from the text that follows it.
const BULLET_GLYPHS = new Set(['●', '○', '■', '□', '▪', '▫', '◦', '•', '‣']);
// A bare closing quote/apostrophe fragment — the other common PDF-copy
// artifact, where a wrapped line's leading punctuation lands alone.
const ORPHAN_QUOTE_RE = /^["'“”‘’]$/;

// A deliberate paragraph break in real prose almost always ends in sentence
// punctuation (or a colon, before a list); a plain paragraph that doesn't is
// far more likely a visual line a PDF viewer's copy split mid-sentence.
function endsUnfinished(text) {
  return !/[.!?:;][”’"')]?$/.test(text.trim());
}

// A block that itself opens a new numbered item or is a bullet marker is
// never a wrapped continuation of the paragraph before it, even when that
// paragraph lacks trailing punctuation (e.g. a section title like "The first
// day" sitting directly above "1. Be with Thomas...").
function looksLikeNewItem(text) {
  const t = text.trim();
  return /^\d+\.\s/.test(t) || BULLET_GLYPHS.has(t);
}

// Re-joins plain paragraphs a PDF copy fragmented into separate visual
// lines: a wrapped sentence/list item (previous text has no sentence-ending
// punctuation yet) and an orphaned closing quote (always a fragment, never
// a real paragraph on its own) both get glued onto the paragraph before
// them. Only ever touches blocks already marked `plain` — a heading, a real
// list, an mso-list line, a table row, etc. is one complete unit already and
// must never absorb or be absorbed.
function mergeWrappedLines(blocks) {
  const out = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    // A lone bullet marker is never a wrapped continuation of *its own*
    // prose — it's left untouched here so zipBulletMarkers can still find it
    // immediately followed by its actual content, one block per marker.
    const prevIsBulletMarker = !!prev && BULLET_GLYPHS.has(prev.text.trim());
    const isOrphanQuote = ORPHAN_QUOTE_RE.test(block.text.trim());
    const isWrap = !!prev && endsUnfinished(prev.text) && !looksLikeNewItem(block.text);
    if (prev && prev.plain && block.plain && !prevIsBulletMarker && (isOrphanQuote || isWrap)) {
      prev.text = prev.text + (isOrphanQuote ? '' : ' ') + block.text.trim();
      continue;
    }
    out.push({ ...block });
  }
  return out;
}

// A PDF copy can also extract a bullet marker as its own paragraph, ahead of
// — not containing — its text (e.g. four "●" paragraphs immediately followed
// by four plain-text paragraphs). Once wrapped lines above are rejoined, a
// run of N marker-only paragraphs followed by exactly N plain paragraphs is
// unambiguously that pattern; zip them into one real list block.
function zipBulletMarkers(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].plain && BULLET_GLYPHS.has(blocks[i].text.trim())) {
      let n = 0;
      while (i + n < blocks.length && blocks[i + n].plain && BULLET_GLYPHS.has(blocks[i + n].text.trim())) n++;
      const content = blocks.slice(i + n, i + n + n);
      if (content.length === n && content.every((b) => b.plain)) {
        out.push({ text: content.map((b) => '- ' + b.text.trim()).join('\n'), plain: false });
        i += n + n;
        continue;
      }
    }
    out.push(blocks[i]);
    i++;
  }
  return out;
}

function reflowParagraphs(blocks) {
  return zipBulletMarkers(mergeWrappedLines(blocks));
}

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const classSizes = parseClassFontSizes(doc);
  const ctx = { classSizes, bodySize: computeBodyFontSize(doc.body, classSizes) };
  const blocks = [];
  walkBlocks(doc.body, blocks, ctx);
  const nonEmpty = blocks.filter((b) => b.text.trim() !== '');
  return reflowParagraphs(nonEmpty).map((b) => b.text).join('\n\n');
}
