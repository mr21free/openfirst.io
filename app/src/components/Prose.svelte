<script>
  import { renderMarkdown } from '../lib/markdown.js';

  let { pkg, markdown = '', onOpen, onTag = null, onView = null } = $props();

  let el = $state(null);
  const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?)$/i;
  const VIDEO_EXT = /\.mp4$/i;
  function imageInfo(id) {
    const ent = pkg.entity(id);
    const att = ent?.kind === 'attachment' ? ent.obj : null;
    const src = pkg.attachmentUrls?.[id];
    if (!att || !src) return null;
    const isImage = (att.mime || '').startsWith('image/') || IMG_EXT.test(att.path || att.filename || '');
    if (!isImage) return null;
    return {
      src,
      name: pkg.name(id),
      alt: att.description || att.filename || pkg.name(id),
      caption: att.description || ''
    };
  }
  function videoInfo(id) {
    const ent = pkg.entity(id);
    const att = ent?.kind === 'attachment' ? ent.obj : null;
    const src = pkg.attachmentUrls?.[id];
    if (!att || !src) return null;
    const isVideo = (att.mime || '').toLowerCase() === 'video/mp4' || VIDEO_EXT.test([att.original_filename, att.path, att.filename].filter(Boolean).join(' '));
    if (!isVideo) return null;
    return {
      src,
      name: pkg.name(id),
      title: att.description || att.filename || pkg.name(id),
      caption: att.description || ''
    };
  }
  const html = $derived(renderMarkdown(
    markdown,
    (id) => (pkg.entity(id) ? pkg.name(id) : null),
    imageInfo,
    videoInfo
  ));

  // Cross-links come ONLY from explicit [[id]] references the author inserted
  // (the markdown pass renders those as <a class="xref">). We deliberately do
  // not auto-link plain prose that merely happens to match an entity's name —
  // typing a name is not the same as making a reference, and silently linking
  // every occurrence surprised people (a referenced name leaking its link onto
  // unrelated mentions, headings, bold labels…). What you reference is what links.

  // Surface an entity's metadata inline after each cross-link — so a reader sees
  // "follow Account access [Importance: high]" or "the VPN [Price: 45 EUR/year]"
  // without opening it. Importance is shown for any non-person; price for items
  // that have one. People carry neither.
  const IMP_LEVELS = new Set(['high', 'medium', 'low']);
  function decorateRefMeta() {
    if (!el || !pkg) return;
    for (const a of el.querySelectorAll('a.xref[data-id]')) {
      if (a.dataset.refMeta) continue;
      a.dataset.refMeta = '1';
      const ent = pkg.entity(a.dataset.id);
      if (!ent || ent.kind === 'person') continue;
      const o = ent.obj || {};
      const tags = [];
      if (IMP_LEVELS.has(o.importance)) tags.push(['xref-imp imp-' + o.importance, 'Importance: ' + o.importance]);
      if (ent.kind === 'item' && o.price != null && String(o.price).trim()) tags.push(['xref-price', 'Price: ' + String(o.price).trim()]);
      let cursor = a;
      for (const [cls, label] of tags) {
        const space = document.createTextNode(' ');
        const mark = document.createElement('span');
        mark.className = cls;
        mark.title = label;
        mark.textContent = '[' + label + ']';
        cursor.after(space); space.after(mark); cursor = mark;
      }
    }
  }
  function prepareVideos() {
    if (!el) return;
    for (const video of el.querySelectorAll('video.guide-video')) {
      if (video.dataset.videoReady) continue;
      video.dataset.videoReady = '1';
      try { video.load(); } catch (_) {}
    }
  }

  $effect(() => {
    html; // re-run whenever the rendered markdown changes
    queueMicrotask(() => {
      decorateRefMeta();
      prepareVideos();
    });
  });

  // Delegated handlers for the cross-link anchors we inject. Attached
  // programmatically so the rendered prose stays a plain document.
  $effect(() => {
    if (!el) return;
    const open = (id) => { if (id) onOpen?.(id); };
    const act = (e, a) => {
      if (a?.dataset.tag) { e.preventDefault(); onTag?.(a.dataset.tag, a.dataset.tagKind || 'file'); }
      else if (a?.dataset.view) { e.preventDefault(); onView?.(a.dataset.view, a.dataset.viewTags || null); }
      else if (a?.dataset.id) { e.preventDefault(); open(a.dataset.id); }
    };
    const click = (e) => act(e, e.target.closest?.('a.xref, button.guide-img'));
    const key = (e) => { if (e.key === 'Enter') act(e, e.target.closest?.('a.xref, button.guide-img')); };
    el.addEventListener('click', click);
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('click', click); el.removeEventListener('keydown', key); };
  });
</script>

<div class="prose" bind:this={el}>
  {@html html}
</div>
