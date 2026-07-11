<script>
  import { tick, untrack } from 'svelte';
  import { iconInner } from '../lib/icons.js';

  // Guide content editor (Markdown stored as text). References are embedded as
  // [[id]] tokens, shown here as atomic, non-editable PILLS — the Contentful /
  // Kontent / Frontify "embedded entry" pattern. A toolbar, searchable reference
  // insertion and fullscreen. The language follows the top language selector.
  // `raw` is read-only here (the live entity); all writes go up via callbacks so
  // this editor never mutates a prop owned by the store.
  //
  // Two modes:
  //  • Guide mode (default): the per-language guide body — seeds from
  //    raw.content[L] and writes via onContent(L, markdown) + onAddRef.
  //  • Plain mode: any single markdown string (e.g. an object's Notes) — pass
  //    `value` + `onValue`; language and reference tracking don't apply.
  let { pkg, raw, lang = null, onContent, onAddRef, onUploadMedia = null, value = null, onValue = null, compact = false, placeholder = null } = $props();

  const plain = $derived(typeof onValue === 'function');
  const GUIDE_PH = '## Heading\n\nWrite the guide here. Type “@” to mention a person, item or location — or use “+ Reference”.';
  const L = $derived((lang && (pkg.languages || []).includes(lang)) ? lang : (pkg.lang || (pkg.languages || ['en'])[0]));
  let full = $state(false);
  let refOpen = $state(false);
  let refSearch = $state('');
  let editorEl = $state(null);
  let mediaInput = $state(null);
  let savedRange = null;

  function setVal(v) { if (plain) onValue(v); else onContent?.(L, v); }

  // ---- DOM <-> Markdown(with [[id]] tokens) ----
  // Special, non-entity references: file tags ([[tag:slug]]), views
  // ([[view:map]]) and inline media attachments ([[img:attachment_id]],
  // [[video:attachment_id]]).
  const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?)$/i;
  const VIDEO_EXT = /\.mp4$/i;
  const imageId = (id) => /^img:([a-z0-9_-]+)$/i.exec(id)?.[1] || null;
  const videoId = (id) => /^video:([a-z0-9_-]+)$/i.exec(id)?.[1] || null;
  const isImageAttachment = (id) => {
    const ent = pkg.entity(id);
    const att = ent?.kind === 'attachment' ? ent.obj : null;
    return !!att && ((att.mime || '').startsWith('image/') || IMG_EXT.test(att.path || att.filename || ''));
  };
  const isVideoAttachment = (id) => {
    const ent = pkg.entity(id);
    const att = ent?.kind === 'attachment' ? ent.obj : null;
    return !!att && ((att.mime || '').toLowerCase() === 'video/mp4' || VIDEO_EXT.test(att.path || att.filename || ''));
  };
  const special = (id) => id.startsWith('tag:') || id.startsWith('view:') || id.startsWith('img:') || id.startsWith('video:');
  const validSpecial = (id) => id.startsWith('tag:') || id.startsWith('view:') || (!!imageId(id) && isImageAttachment(imageId(id))) || (!!videoId(id) && isVideoAttachment(videoId(id)));
  // A small leading icon per chip type, so you can tell a person from an item at
  // a glance while editing. (Shared icon set; inner markup only.)
  const chipIconSvg = (kind) =>
    `<svg class="chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconInner(kind)}</svg>`;
  function makeChip(id) {
    const span = document.createElement('span');
    span.className = 'refchip';
    span.setAttribute('contenteditable', 'false');
    span.dataset.refId = id;
    let kind, label;
    if (id.startsWith('tag:')) { span.classList.add('tagchip-inline'); kind = 'tag'; label = id.slice(4); }
    else if (id.startsWith('view:')) { span.classList.add('viewchip-inline'); kind = 'view'; label = id.slice(5).replace(/^./, (c) => c.toUpperCase()); }
    else if (imageId(id)) { span.classList.add('imgchip-inline'); kind = 'image'; label = `Image: ${pkg.name(imageId(id))}`; }
    else if (videoId(id)) { span.classList.add('videochip-inline'); kind = 'video'; label = `Video: ${pkg.name(videoId(id))}`; }
    else { kind = pkg.entity(id)?.kind || 'item'; label = pkg.name(id); }
    span.insertAdjacentHTML('afterbegin', chipIconSvg(kind)); // controlled SVG only
    span.appendChild(document.createTextNode(label));         // user text stays text
    return span;
  }
  function renderDom(text) {
    if (!editorEl) return;
    editorEl.innerHTML = '';
    const parts = (text || '').split(/(\[\[[a-z0-9_:-]+\]\])/gi);
    for (const part of parts) {
      const m = part.match(/^\[\[([a-z0-9_:-]+)\]\]$/i);
      if (m && (validSpecial(m[1]) || pkg.entity(m[1]))) editorEl.appendChild(makeChip(m[1]));
      else if (m) editorEl.appendChild(document.createTextNode(part));
      else if (part) editorEl.appendChild(document.createTextNode(part));
    }
    guardChips();
  }
  // A chip is contenteditable=false, so when it sits at the very start of a line
  // (first node, or after a <br>/<div>, or right after a newline) there's no caret
  // slot before it — you can't click or arrow in front to type. Drop an invisible
  // zero-width space there as that slot. Stripped on serialize so markdown stays clean.
  const ZW = '\u200B';
  function guardChips() {
    if (!editorEl) return;
    for (const chip of editorEl.querySelectorAll('.refchip')) {
      const prev = chip.previousSibling;
      const atLineStart = !prev || prev.nodeType === 1 || (prev.nodeType === 3 && /\n$/.test(prev.nodeValue));
      const alreadyGuarded = prev && prev.nodeType === 3 && prev.nodeValue === ZW;
      if (atLineStart && !alreadyGuarded) chip.parentNode.insertBefore(document.createTextNode(ZW), chip);
    }
  }
  function serializeNodes(nodes) {
    let out = '';
    nodes.forEach((n) => {
      if (n.nodeType === 3) out += n.nodeValue.replace(/\u200B/g, '');
      else if (n.nodeType === 1) {
        if (n.dataset && n.dataset.refId) out += '[[' + n.dataset.refId + ']]';
        else if (n.tagName === 'BR') out += '\n';
        else { const inner = serializeNodes(n.childNodes); out += (n.tagName === 'DIV' || n.tagName === 'P') ? '\n' + inner : inner; }
      }
    });
    return out;
  }
  function syncFromDom() {
    if (editorEl) {
      guardChips();
      const v = serializeNodes(editorEl.childNodes);
      setVal(v);
      schedulePushHistory(v);
    }
  }

  // ---- Undo / redo ----
  // Native contenteditable undo would fight our programmatic DOM (chips,
  // toolbar inserts), so we keep our own value history: each input burst
  // (350ms debounce) becomes one step. Undo/redo re-render from markdown and
  // put the caret at the end — coarse but predictable.
  let history = $state([]);
  let histIndex = $state(-1);
  let histTimer = null;
  const canUndo = $derived(histIndex > 0);
  const canRedo = $derived(histIndex < history.length - 1);

  function resetHistory(v) {
    clearTimeout(histTimer);
    history = [v ?? ''];
    histIndex = 0;
  }
  function schedulePushHistory(v) {
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      if (history[histIndex] === v) return;
      history = [...history.slice(Math.max(0, histIndex - 99), histIndex + 1), v];
      histIndex = history.length - 1;
    }, 350);
  }
  function applyHistory(v) {
    renderDom(v);
    setVal(v);
    // Caret to the end — the render rebuilt the DOM.
    editorEl?.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  function undo() { if (canUndo) { clearTimeout(histTimer); histIndex -= 1; applyHistory(history[histIndex]); } }
  function redo() { if (canRedo) { clearTimeout(histTimer); histIndex += 1; applyHistory(history[histIndex]); } }

  // Re-render the DOM only when the editor mounts, the guide changes, or the
  // language changes — never on input (so the caret stays put).
  $effect(() => {
    const el = editorEl, a = L, id = raw?.id;
    if (!el) return;
    const v = untrack(() => (plain ? (value || '') : ((id, raw?.content?.[a]) || '')));
    renderDom(v);
    resetHistory(v);
  });

  // ---- caret helpers ----
  function caret() {
    const sel = window.getSelection();
    if (sel.rangeCount && editorEl.contains(sel.anchorNode)) return { sel, range: sel.getRangeAt(0) };
    editorEl.focus();
    const range = document.createRange();
    range.selectNodeContents(editorEl); range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    return { sel, range };
  }
  function placeAfter(node, sel) {
    const r = document.createRange(); r.setStartAfter(node); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  }
  function saveCaret() {
    const sel = window.getSelection();
    if (sel.rangeCount && editorEl?.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreCaret() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function insertText(str) {
    const { sel, range } = caret(); range.deleteContents();
    const t = document.createTextNode(str); range.insertNode(t); placeAfter(t, sel); syncFromDom();
  }
  function surround(before, after = before) {
    const { sel, range } = caret(); const text = range.toString(); range.deleteContents();
    const node = document.createTextNode(before + text + after); range.insertNode(node);
    const r = document.createRange(); r.setStart(node, before.length + text.length); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r); syncFromDom();
  }
  // Build a DOM fragment from markdown text, turning [[id]] tokens back into
  // reference chips (so reformatting a selection never flattens a mention into
  // its raw [[id]] source).
  function fragFromMarkdown(text) {
    const frag = document.createDocumentFragment();
    let last = null;
    for (const part of (text || '').split(/(\[\[[a-z0-9_:-]+\]\])/gi)) {
      const m = part.match(/^\[\[([a-z0-9_:-]+)\]\]$/i);
      if (m && (validSpecial(m[1]) || pkg.entity(m[1]))) last = frag.appendChild(makeChip(m[1]));
      else if (part) last = frag.appendChild(document.createTextNode(part));
    }
    return { frag, last };
  }
  function prefixLine(prefix) {
    const { sel, range } = caret();
    if (!range.collapsed) {
      const frag = range.cloneContents();
      const text = serializeNodes(frag.childNodes);
      const lines = text.split('\n');
      const nonEmpty = lines.filter((l) => l.trim());
      // If every non-empty line already has the prefix → toggle off; otherwise → add.
      const allOn = nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
      const result = lines.map((line) => {
        if (allOn) return line.startsWith(prefix) ? line.slice(prefix.length) : line;
        return (line.trim() && !line.startsWith(prefix)) ? prefix + line : line;
      }).join('\n');
      range.deleteContents();
      const { frag: out, last } = fragFromMarkdown(result); range.insertNode(out); if (last) placeAfter(last, sel);
      syncFromDom();
      return;
    }
    const node = range.startContainer;
    if (node.nodeType === 3) {
      const text = node.nodeValue, off = range.startOffset, ls = text.lastIndexOf('\n', off - 1) + 1;
      if (text.slice(ls).startsWith(prefix)) {
        // Toggle off: remove prefix, move cursor back by prefix.length
        node.nodeValue = text.slice(0, ls) + text.slice(ls + prefix.length);
        const r = document.createRange(); r.setStart(node, Math.max(ls, off - prefix.length)); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else {
        node.nodeValue = text.slice(0, ls) + prefix + text.slice(ls);
        const r = document.createRange(); r.setStart(node, off + prefix.length); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
    } else insertText(prefix);
    syncFromDom();
  }

  // Numbered list: like prefixLine, but each non-empty line gets a running
  // "1. ", "2. "… (and toggles off when every line is already numbered).
  function orderedList() {
    const num = /^\d+\.\s/;
    const { sel, range } = caret();
    if (!range.collapsed) {
      const lines = serializeNodes(range.cloneContents().childNodes).split('\n');
      const nonEmpty = lines.filter((l) => l.trim());
      const allOn = nonEmpty.length > 0 && nonEmpty.every((l) => num.test(l));
      let n = 0;
      const result = lines.map((line) => {
        if (!line.trim()) return line;
        const bare = line.replace(num, '');
        return allOn ? bare : `${++n}. ${bare}`;
      }).join('\n');
      range.deleteContents();
      const { frag, last } = fragFromMarkdown(result); range.insertNode(frag); if (last) placeAfter(last, sel);
      syncFromDom();
      return;
    }
    const node = range.startContainer;
    if (node.nodeType === 3) {
      const text = node.nodeValue, off = range.startOffset, ls = text.lastIndexOf('\n', off - 1) + 1;
      const line = text.slice(ls), m = line.match(num);
      if (m) {
        node.nodeValue = text.slice(0, ls) + line.replace(num, '');
        const r = document.createRange(); r.setStart(node, Math.max(ls, off - m[0].length)); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else {
        node.nodeValue = text.slice(0, ls) + '1. ' + line;
        const r = document.createRange(); r.setStart(node, off + 3); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
    } else insertText('1. ');
    syncFromDom();
  }

  const REF_KEY = { person: 'person_ids', role: 'role_ids', item: 'item_ids', location: 'location_ids', guide: 'guide_ids', attachment: 'attachment_ids' };
  function registerRef(id) {
    const media = imageId(id) || videoId(id);
    if (media) {
      onAddRef?.('attachment_ids', media);
      return;
    }
    const ent = pkg.entity(id);
    const key = ent && REF_KEY[ent.kind];
    if (!key) return;
    onAddRef?.(key, id);
  }
  // Insert an entity OR a file-tag as an atomic chip ([[id]] / [[tag:slug]]).
  // Clicking a tag chip in the reader opens Files filtered to that tag.
  function insertRef(id) {
    if (!validSpecial(id) && !pkg.entity(id)) return;
    if (!id.startsWith('tag:') && !id.startsWith('view:')) registerRef(id);
    const { sel, range } = caret(); range.deleteContents();
    const frag = document.createDocumentFragment();
    const chip = makeChip(id), space = document.createTextNode(' ');
    frag.appendChild(chip); frag.appendChild(space); range.insertNode(frag);
    placeAfter(space, sel); syncFromDom();
    refOpen = false; refSearch = '';
  }

  async function onMediaPicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const isImage = !!file && ((file.type || '').startsWith('image/') || IMG_EXT.test(file.name || ''));
    const isVideo = !!file && ((file.type || '').toLowerCase() === 'video/mp4' || VIDEO_EXT.test(file.name || ''));
    if (!file || (!isImage && !isVideo) || !onUploadMedia) return;
    const result = await onUploadMedia(file);
    if (result?.id && result?.kind) {
      await tick();
      restoreCaret();
      insertRef(result.kind + ':' + result.id);
    }
  }

  // Secondary line in the reference list — only meaningful detail, never a
  // repeat of the kind (the kind is already shown). Locations show their path.
  function subLabel(kind, o) {
    if (kind === 'person') return (o.roles || []).map((r) => pkg.roleLabel(r)).join(', ');
    if (kind === 'item') return o.price || '';
    if (kind === 'location') return pkg.locationPath(o.id).map((a) => pkg.name(a.id)).join(' › ');
    return '';
  }
  function searchText(kind, o) {
    const base = pkg.name(o.id);
    let extra = '';
    if (kind === 'person') extra = [o.nickname, o.name, o.display_as, ...(o.roles || []).map((r) => pkg.roleLabel(r))].filter(Boolean).join(' ');
    else if (kind === 'attachment') extra = [o.filename, o.path, o.mime, o.description].filter(Boolean).join(' ');
    else extra = [o.name, o.title].filter(Boolean).join(' ');
    return `${base} ${extra}`.toLowerCase();
  }
  function imageSearchAliases(a) {
    const path = a.path || '';
    const ext = (path || a.filename || '').match(/\.([a-z0-9]+)$/i)?.[1] || '';
    const name = pkg.name(a.id);
    return [
      `img:${name}`,
      ext ? `img:${name}.${ext}` : '',
      path.split('/').pop() || '',
      ext
    ].filter(Boolean).join(' ');
  }
  function videoSearchAliases(a) {
    const path = a.path || '';
    const name = pkg.name(a.id);
    return [`video:${name}`, `video:${name}.mp4`, path.split('/').pop() || '', 'mp4'].filter(Boolean).join(' ');
  }
  const byName = (a, b) => pkg.name(a.id).localeCompare(pkg.name(b.id), undefined, { numeric: true, sensitivity: 'base' });
  const refCandidates = $derived.by(() => {
    const out = [];
    for (const k of ['person', 'role', 'item', 'location', 'guide', 'attachment']) {
      const arr = (k === 'person' ? pkg.people : k === 'role' ? pkg.roles : k === 'item' ? pkg.items : k === 'location' ? pkg.locations : k === 'guide' ? pkg.guides : pkg.attachments) || [];
      for (const o of [...arr].sort(byName)) if (o.id !== raw.id) out.push({ id: o.id, kind: k, name: pkg.name(o.id), sub: subLabel(k, o), search: searchText(k, o) });
    }
    for (const a of [...(pkg.attachments || [])].filter((att) => isImageAttachment(att.id)).sort(byName)) {
      out.push({
        id: 'img:' + a.id,
        kind: 'image',
        name: 'Image: ' + pkg.name(a.id),
        sub: a.description || a.filename || '',
        search: `${imageSearchAliases(a)} image ${searchText('attachment', a)}`.toLowerCase()
      });
    }
    for (const a of [...(pkg.attachments || [])].filter((att) => isVideoAttachment(att.id)).sort(byName)) {
      out.push({
        id: 'video:' + a.id,
        kind: 'video',
        name: 'Video: ' + pkg.name(a.id),
        sub: a.description || a.filename || '',
        search: `${videoSearchAliases(a)} video ${searchText('attachment', a)}`.toLowerCase()
      });
    }
    for (const t of pkg.allTags()) {
      const n = pkg.attachmentsWithTag(t).length;
      out.push({ id: 'tag:' + t, kind: 'tag', name: '# ' + t, sub: `${n} file${n === 1 ? '' : 's'}`, search: 'tag ' + t });
    }
    // The Map view (where everything is) — referenceable when it has content.
    if ((pkg.locations || []).length || (pkg.items || []).length) {
      out.push({ id: 'view:map', kind: 'view', name: 'Map', sub: 'where everything is', search: 'map where is everything overview' });
    }
    return out;
  });
  function filterRefs(q) {
    const s = (q || '').trim().toLowerCase();
    return (s ? refCandidates.filter((o) => o.search.includes(s)) : refCandidates).slice(0, 40);
  }
  const refOptions = $derived.by(() => {
    return filterRefs(refSearch);
  });

  // Copy/cut/paste in the markdown form, so reference PILLS survive the clipboard.
  function onCopy(e) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editorEl.contains(sel.anchorNode)) return;
    const md = serializeNodes(sel.getRangeAt(0).cloneContents().childNodes);
    e.clipboardData.setData('text/plain', md);
    e.preventDefault();
  }
  function onCut(e) {
    onCopy(e);
    if (e.defaultPrevented) {
      const sel = window.getSelection();
      if (sel.rangeCount) sel.getRangeAt(0).deleteContents();
      syncFromDom();
    }
  }
  function onPaste(e) {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    const { sel, range } = caret(); range.deleteContents();
    const frag = document.createDocumentFragment();
    let last = null;
    for (const part of text.split(/(\[\[[a-z0-9_:-]+\]\])/gi)) {
      const m = part.match(/^\[\[([a-z0-9_:-]+)\]\]$/i);
      if (m && validSpecial(m[1])) { if (imageId(m[1]) || videoId(m[1])) registerRef(m[1]); last = frag.appendChild(makeChip(m[1])); }
      else if (m && pkg.entity(m[1])) { registerRef(m[1]); last = frag.appendChild(makeChip(m[1])); }
      else if (part) last = frag.appendChild(document.createTextNode(part));
    }
    range.insertNode(frag);
    if (last) placeAfter(last, sel);
    syncFromDom();
  }

  function closeRef() { refOpen = false; refSearch = ''; }

  // ---- "@" mention autocomplete ----
  let mention = $state(null); // { query, node, atOffset, x, y }
  let mentionIndex = $state(0);
  let mentionPopEl = $state(null);
  const mentionOptions = $derived(mention ? filterRefs(mention.query) : []);
  // Keep the highlighted option in view as you arrow through a long list.
  $effect(() => {
    if (!mention) return;
    mentionIndex;
    mentionPopEl?.querySelector('.refrow.on')?.scrollIntoView({ block: 'nearest' });
  });

  function onEditorInput() { syncFromDom(); checkMention(); }
  function checkMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) { mention = null; return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) { mention = null; return; }
    const m = node.nodeValue.slice(0, range.startOffset).match(/(?:^|\s)@([\p{L}\p{N}_:.-]*)$/u);
    if (!m) { mention = null; return; }
    const rect = range.getBoundingClientRect();
    const er = editorEl.getBoundingClientRect();
    mention = {
      query: m[1], node, atOffset: range.startOffset - m[1].length - 1,
      x: rect.left || er.left + 14, y: rect.bottom || er.top + 26
    };
    mentionIndex = 0;
  }
  function pickMention(id) {
    if (!mention || (!pkg.entity(id) && !validSpecial(id))) return;
    const { node, atOffset, query } = mention;
    const range = document.createRange();
    range.setStart(node, atOffset);
    range.setEnd(node, Math.min(atOffset + 1 + query.length, node.nodeValue.length));
    range.deleteContents();
    if (!id.startsWith('tag:') && !id.startsWith('view:')) registerRef(id);
    const chip = makeChip(id), space = document.createTextNode(' ');
    const frag = document.createDocumentFragment();
    frag.appendChild(chip); frag.appendChild(space);
    range.insertNode(frag);
    const sel = window.getSelection();
    const r = document.createRange(); r.setStartAfter(space); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    mention = null;
    syncFromDom();
  }
  function onEditorKey(e) {
    // Undo/redo — ours, not the browser's (native undo fights the chip DOM).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (!mention) return;
    const n = mentionOptions.length;
    if (!n && e.key !== 'Escape') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex = (mentionIndex + 1) % n; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex = (mentionIndex - 1 + n) % n; }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionOptions[mentionIndex]?.id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mention = null; }
  }
  // Close the mention popup on click-away.
  $effect(() => {
    if (!mention) return;
    const onDown = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || (!t.closest('.mentionpop') && !editorEl.contains(t))) mention = null;
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  // Close the "+ Reference" popover on click-away or Escape.
  $effect(() => {
    if (!refOpen) return;
    const onDown = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('.refwrap')) closeRef();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeRef(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div class="ce" class:full class:compact>
  {#if onUploadMedia}
    <input bind:this={mediaInput} type="file" accept="image/*,video/mp4,.mp4" hidden onchange={onMediaPicked} />
  {/if}
  <div class="toolbar">
    <button class="iconbtn tb" data-tip="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onclick={undo}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
    </button>
    <button class="iconbtn tb" data-tip="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onclick={redo}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>
    </button>
    <span class="tb-sep" aria-hidden="true"></span>
    <button class="iconbtn tb" data-tip="Bold" onclick={() => surround('**')}><b>B</b></button>
    <button class="iconbtn tb" data-tip="Italic" onclick={() => surround('*')}><i>I</i></button>
    <button class="iconbtn tb" data-tip="Heading" onclick={() => prefixLine('## ')}>H</button>
    <button class="iconbtn tb" data-tip="Bullet list" onclick={() => prefixLine('- ')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
        <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button class="iconbtn tb" data-tip="Numbered list" onclick={() => orderedList()}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" />
        <text x="0.5" y="8.5" font-size="8" stroke="none" fill="currentColor">1</text>
        <text x="0.5" y="14.5" font-size="8" stroke="none" fill="currentColor">2</text>
        <text x="0.5" y="20.5" font-size="8" stroke="none" fill="currentColor">3</text>
      </svg>
    </button>
    <button class="iconbtn tb" data-tip="Link" onclick={() => surround('[', '](https://)')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
    {#if onUploadMedia}
      <button class="iconbtn tb" data-tip="Upload media" aria-label="Upload media" onmousedown={(e) => { e.preventDefault(); saveCaret(); }} onclick={() => { saveCaret(); mediaInput?.click(); }}>
        <svg class="tb-media-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="1" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 16l-5-5-4 4-2-2-5 5" />
          <path d="M13 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
        </svg>
      </button>
    {/if}
    <div class="refwrap">
      <button class="tb-ref" onclick={() => { refOpen = !refOpen; refSearch = ''; }}>@ Mention</button>
      {#if refOpen}
        <div class="refpop">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="refq" placeholder="Search people, items, locations…" bind:value={refSearch} autofocus />
          <div class="reflist">
            {#each refOptions as o}
              <button class="refrow" onclick={() => insertRef(o.id)}>
                <span class="refname">{o.name}</span><span class="refsub">{o.kind}{o.sub ? ` · ${o.sub}` : ''}</span>
              </button>
            {:else}
              <div class="refnone tiny muted">No matches.</div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    <button class="iconbtn tb tb-expand" data-tip={full ? 'Collapse' : 'Expand to full screen'} data-tip-pos="left" aria-label={full ? 'Collapse' : 'Expand to full screen'} onclick={() => (full = !full)}>
      {#if full}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      {:else}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      {/if}
    </button>
  </div>
  <div bind:this={editorEl} class="ce-edit" contenteditable="true" role="textbox" tabindex="0" aria-multiline="true"
    data-ph={placeholder ?? GUIDE_PH}
    oninput={onEditorInput} onkeydown={onEditorKey} oncopy={onCopy} oncut={onCut} onpaste={onPaste}></div>
</div>

{#if mention && mentionOptions.length}
  <div class="mentionpop" bind:this={mentionPopEl} style="left:{mention.x}px; top:{mention.y}px;">
    <div class="reflist">
      {#each mentionOptions as o, i}
        <button class="refrow" class:on={i === mentionIndex} onmousedown={(e) => { e.preventDefault(); pickMention(o.id); }}>
          <span class="refname">{o.name}</span><span class="refsub">{o.kind}{o.sub ? ` · ${o.sub}` : ''}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

{#if full}<div class="fs-scrim" onclick={() => (full = false)} role="presentation"></div>{/if}

<style>
  .ce { background: var(--paper); display: flex; flex-direction: column; }
  .ce.full { position: fixed; inset: 24px; z-index: var(--z-editor-full); border: 1px solid var(--rule); border-radius: 0; overflow: hidden; box-shadow: 0 30px 80px oklch(0.2 0.03 255 / 0.3); }
  .fs-scrim { position: fixed; inset: 0; background: oklch(0.2 0.03 255 / 0.3); z-index: 79; }
  /* Keep the formatting actions reachable while scrolling a long guide. In
     full mode the editor body scrolls internally, so the bar already stays put;
     this makes it stick to the top of the viewport in normal mode too. */
  /* Sticks to the top while scrolling a long guide. The offset clears the page's
     sticky top bar in the guide editor (set via --ce-toolbar-top); in the
     in-drawer Notes editor it stays 0 and pins to the drawer's own top. */
  .toolbar { position: sticky; top: var(--ce-toolbar-top, 0px); z-index: 10; background: var(--paper); display: flex; align-items: center; gap: 6px; padding: 8px 22px; border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); flex-wrap: wrap; flex: none; }
  .ce.full .toolbar { position: static; }
  .tb {
    width: 30px; height: 30px;
    display: inline-grid; place-items: center;
    padding: 0; line-height: 1;
  }
  .tb svg { display: block; width: 15px; height: 15px; }
  .tb b, .tb i { display: block; line-height: 1; }
  .tb .tb-media-ico { width: 18px; height: 18px; }
  .tb-expand { margin-left: auto; }
  .tb-sep { width: 1px; height: 18px; background: var(--rule); margin: 0 4px; flex: none; }
  .refwrap { position: relative; }
  .tb-ref { font-size: 13px; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 12px; background: var(--paper); color: var(--accent-deep); cursor: pointer; }
  .tb-ref:hover { border-color: var(--accent-deep); }
  .refpop { position: absolute; top: 36px; left: 0; z-index: var(--z-popover); width: 320px; max-width: 80vw; background: var(--paper); border: 1px solid var(--rule); border-radius: 0; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 8px; }
  .refq { width: 100%; font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; background: var(--paper); color: var(--ink); }
  .reflist { max-height: 240px; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; scrollbar-width: thin; }
  /* Always show a slim scrollbar so it's clear when the list runs longer than the box. */
  .reflist::-webkit-scrollbar { width: 8px; }
  .reflist::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 4px; }
  .reflist::-webkit-scrollbar-thumb:hover { background: var(--ink-mute); }
  .refrow { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; text-align: left; padding: 7px 9px; border-radius: 7px; }
  .refrow:hover, .refrow.on { background: var(--accent-wash); }
  .mentionpop {
    position: fixed; z-index: 90; width: 280px; max-width: 80vw;
    background: var(--paper); border: 1px solid var(--rule); border-radius: 0;
    box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 6px;
  }
  .mentionpop .reflist { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; }
  .refname { font-size: 14px; color: var(--ink); }
  .refsub { font-size: 11px; color: var(--ink-mute); }
  .refnone { padding: 10px; }
  .ce-edit { flex: 1; min-height: 200px; padding: 18px 22px; font: inherit; font-size: 15px; line-height: 1.7; color: var(--ink); white-space: pre-wrap; word-break: break-word; overflow-y: auto; }
  .ce.full .ce-edit { min-height: 0; }
  /* Compact: a bordered, input-sized editor (e.g. an object's Notes field). */
  .ce.compact { border: 1px solid var(--rule); border-radius: 0; overflow: hidden; }
  .ce.compact .toolbar { padding: 6px 10px; border-top: none; }
  .ce.compact .ce-edit { min-height: 104px; padding: 12px 14px; font-size: 14px; line-height: 1.6; }
  .ce-edit:focus { outline: none; }
  .ce-edit:empty::before { content: attr(data-ph); color: var(--ink-mute); white-space: pre-wrap; pointer-events: none; }
  .ce-edit :global(.refchip) {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--accent-wash); border: 1px solid var(--accent); color: var(--accent-deep);
    border-radius: 6px; padding: 0 6px; margin: 0 1px; font-size: 0.92em; white-space: nowrap;
    user-select: none;
  }
  /* Leading type icon (person/item/location/…) so chips are scannable while editing. */
  .ce-edit :global(.refchip .chip-ico) { width: 13px; height: 13px; flex: none; opacity: 0.75; }
  /* File-tag chips look like reference chips but are clearly a tag. */
  .ce-edit :global(.refchip.tagchip-inline) { background: var(--paper); border-style: dashed; }
  /* A view reference (Map) — a solid accent pill. */
  .ce-edit :global(.refchip.viewchip-inline) { background: var(--accent); border-color: var(--accent); color: #fff; }
  /* Inline image reference — rendered as an actual image in read mode. */
  .ce-edit :global(.refchip.imgchip-inline) { background: var(--accent-wash); border-color: var(--accent-deep); }
  .ce-edit :global(.refchip.videochip-inline) { background: var(--accent-wash); border-color: var(--accent-deep); }
</style>
