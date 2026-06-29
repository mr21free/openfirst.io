<script>
  import { untrack } from 'svelte';

  // Guide content editor (Markdown stored as text). References are embedded as
  // [[id]] tokens, shown here as atomic, non-editable PILLS — the Contentful /
  // Kontent / Frontify "embedded entry" pattern. A toolbar, searchable reference
  // insertion and fullscreen. The language follows the top language selector.
  // `raw` is read-only here (the live guide); all writes go up via callbacks so
  // this editor never mutates a prop owned by the store.
  let { pkg, raw, lang = null, onContent, onAddRef } = $props();

  const L = $derived((lang && (pkg.languages || []).includes(lang)) ? lang : (pkg.lang || (pkg.languages || ['en'])[0]));
  let full = $state(false);
  let refOpen = $state(false);
  let refSearch = $state('');
  let editorEl = $state(null);

  function setVal(v) { onContent?.(L, v); }

  // ---- DOM <-> Markdown(with [[id]] tokens) ----
  function makeChip(id) {
    const span = document.createElement('span');
    span.className = 'refchip';
    span.setAttribute('contenteditable', 'false');
    span.dataset.refId = id;
    if (id.startsWith('tag:')) { span.classList.add('tagchip-inline'); span.textContent = id.slice(4); }
    else span.textContent = pkg.name(id);
    return span;
  }
  function renderDom(text) {
    if (!editorEl) return;
    editorEl.innerHTML = '';
    const parts = (text || '').split(/(\[\[[a-z0-9_:-]+\]\])/gi);
    for (const part of parts) {
      const m = part.match(/^\[\[([a-z0-9_:-]+)\]\]$/i);
      if (m) editorEl.appendChild(makeChip(m[1]));
      else if (part) editorEl.appendChild(document.createTextNode(part));
    }
  }
  function serializeNodes(nodes) {
    let out = '';
    nodes.forEach((n) => {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.dataset && n.dataset.refId) out += '[[' + n.dataset.refId + ']]';
        else if (n.tagName === 'BR') out += '\n';
        else { const inner = serializeNodes(n.childNodes); out += (n.tagName === 'DIV' || n.tagName === 'P') ? '\n' + inner : inner; }
      }
    });
    return out;
  }
  function syncFromDom() { if (editorEl) setVal(serializeNodes(editorEl.childNodes)); }

  // Re-render the DOM only when the editor mounts, the guide changes, or the
  // language changes — never on input (so the caret stays put).
  $effect(() => {
    const el = editorEl, a = L, id = raw?.id;
    if (!el) return;
    renderDom(untrack(() => (id, raw?.content?.[a]) || ''));
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
      if (m && (m[1].startsWith('tag:') || pkg.entity(m[1]))) last = frag.appendChild(makeChip(m[1]));
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
    const ent = pkg.entity(id);
    const key = ent && REF_KEY[ent.kind];
    if (!key) return;
    onAddRef?.(key, id);
  }
  // Insert an entity OR a file-tag as an atomic chip ([[id]] / [[tag:slug]]).
  // Clicking a tag chip in the reader opens Files filtered to that tag.
  function insertRef(id) {
    if (!id.startsWith('tag:') && !pkg.entity(id)) return;
    if (!id.startsWith('tag:')) registerRef(id);
    const { sel, range } = caret(); range.deleteContents();
    const frag = document.createDocumentFragment();
    const chip = makeChip(id), space = document.createTextNode(' ');
    frag.appendChild(chip); frag.appendChild(space); range.insertNode(frag);
    placeAfter(space, sel); syncFromDom();
    refOpen = false; refSearch = '';
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
    else if (kind === 'attachment') extra = [o.filename, o.description].filter(Boolean).join(' ');
    else extra = [o.name, o.title].filter(Boolean).join(' ');
    return `${base} ${extra}`.toLowerCase();
  }
  const refCandidates = $derived.by(() => {
    const out = [];
    for (const k of ['person', 'role', 'item', 'location', 'guide', 'attachment']) {
      const arr = k === 'person' ? pkg.people : k === 'role' ? pkg.roles : k === 'item' ? pkg.items : k === 'location' ? pkg.locations : k === 'guide' ? pkg.guides : pkg.attachments;
      for (const o of arr || []) if (o.id !== raw.id) out.push({ id: o.id, kind: k, name: pkg.name(o.id), sub: subLabel(k, o), search: searchText(k, o) });
    }
    for (const t of pkg.allTags()) {
      const n = pkg.attachmentsWithTag(t).length;
      out.push({ id: 'tag:' + t, kind: 'tag', name: '# ' + t, sub: `${n} file${n === 1 ? '' : 's'}`, search: 'tag ' + t });
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
      if (m && m[1].startsWith('tag:')) { last = frag.appendChild(makeChip(m[1])); }
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
  const mentionOptions = $derived(mention ? filterRefs(mention.query) : []);

  function onEditorInput() { syncFromDom(); checkMention(); }
  function checkMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) { mention = null; return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) { mention = null; return; }
    const m = node.nodeValue.slice(0, range.startOffset).match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
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
    if (!mention || (!pkg.entity(id) && !id.startsWith('tag:'))) return;
    const { node, atOffset, query } = mention;
    const range = document.createRange();
    range.setStart(node, atOffset);
    range.setEnd(node, Math.min(atOffset + 1 + query.length, node.nodeValue.length));
    range.deleteContents();
    if (!id.startsWith('tag:')) registerRef(id);
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

<div class="ce" class:full>
  <div class="toolbar">
    <button class="tb" title="Bold" onclick={() => surround('**')}><b>B</b></button>
    <button class="tb" title="Italic" onclick={() => surround('*')}><i>I</i></button>
    <button class="tb" title="Heading" onclick={() => prefixLine('## ')}>H</button>
    <button class="tb" title="Bullet list" onclick={() => prefixLine('- ')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
        <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button class="tb" title="Numbered list" onclick={() => orderedList()}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" />
        <text x="0.5" y="8.5" font-size="8" stroke="none" fill="currentColor">1</text>
        <text x="0.5" y="14.5" font-size="8" stroke="none" fill="currentColor">2</text>
        <text x="0.5" y="20.5" font-size="8" stroke="none" fill="currentColor">3</text>
      </svg>
    </button>
    <button class="tb" title="Link" onclick={() => surround('[', '](https://)')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
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
    <button class="tb tb-expand" title={full ? 'Collapse' : 'Expand to full screen'} onclick={() => (full = !full)}>{full ? '⤡' : '⤢'}</button>
  </div>
  <div bind:this={editorEl} class="ce-edit" contenteditable="true" role="textbox" tabindex="0" aria-multiline="true"
    data-ph={'## Heading\n\nWrite the guide here. Type “@” to mention a person, item or location — or use “+ Reference”.'}
    oninput={onEditorInput} onkeydown={onEditorKey} oncopy={onCopy} oncut={onCut} onpaste={onPaste}></div>
</div>

{#if mention && mentionOptions.length}
  <div class="mentionpop" style="left:{mention.x}px; top:{mention.y}px;">
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
  .ce.full { position: fixed; inset: 24px; z-index: 80; border: 1px solid var(--rule); border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px oklch(0.2 0.03 255 / 0.3); }
  .fs-scrim { position: fixed; inset: 0; background: oklch(0.2 0.03 255 / 0.3); z-index: 79; }
  /* Keep the formatting actions reachable while scrolling a long guide. In
     full mode the editor body scrolls internally, so the bar already stays put;
     this makes it stick to the top of the viewport in normal mode too. */
  .toolbar { position: sticky; top: 0; z-index: 10; background: var(--paper); display: flex; align-items: center; gap: 6px; padding: 8px 22px; border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); flex-wrap: wrap; flex: none; }
  .ce.full .toolbar { position: static; }
  .tb { width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--rule); color: var(--ink-soft); background: var(--paper); }
  .tb:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
  .tb-expand { margin-left: auto; }
  .refwrap { position: relative; }
  .tb-ref { font-size: 13px; border: 1px solid var(--rule); border-radius: 999px; padding: 6px 12px; background: var(--paper); color: var(--accent-deep); cursor: pointer; }
  .tb-ref:hover { border-color: var(--accent-deep); }
  .refpop { position: absolute; top: 36px; left: 0; z-index: 5; width: 320px; max-width: 80vw; background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 8px; }
  .refq { width: 100%; font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; background: var(--paper); color: var(--ink); }
  .reflist { max-height: 240px; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; }
  .refrow { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; text-align: left; padding: 7px 9px; border-radius: 7px; }
  .refrow:hover, .refrow.on { background: var(--accent-wash); }
  .mentionpop {
    position: fixed; z-index: 90; width: 280px; max-width: 80vw;
    background: var(--paper); border: 1px solid var(--rule); border-radius: 10px;
    box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 6px;
  }
  .mentionpop .reflist { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; }
  .refname { font-size: 14px; color: var(--ink); }
  .refsub { font-size: 11px; color: var(--ink-mute); }
  .refnone { padding: 10px; }
  .ce-edit { flex: 1; min-height: 200px; padding: 18px 22px; font: inherit; font-size: 15px; line-height: 1.7; color: var(--ink); white-space: pre-wrap; word-break: break-word; overflow-y: auto; }
  .ce.full .ce-edit { min-height: 0; }
  .ce-edit:focus { outline: none; }
  .ce-edit:empty::before { content: attr(data-ph); color: var(--ink-mute); white-space: pre-wrap; pointer-events: none; }
  .ce-edit :global(.refchip) {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--accent-wash); border: 1px solid var(--accent); color: var(--accent-deep);
    border-radius: 6px; padding: 0 6px; margin: 0 1px; font-size: 0.92em; white-space: nowrap;
    user-select: none;
  }
  .ce-edit :global(.refchip)::before { content: '#'; opacity: 0.6; }
  /* File-tag chips look like reference chips but are clearly a tag. */
  .ce-edit :global(.refchip.tagchip-inline) { background: var(--paper); border-style: dashed; }
</style>
