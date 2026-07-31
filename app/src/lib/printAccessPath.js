function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The envelope insert: a printable one-pager of a person's access path.
// Shared by Drawer's "Print the envelope insert" button and Reader's own
// access-path page, so both produce byte-identical output.
export function printAccessPath({ person, pkg }) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const name = escapeHtml(person?.name || 'you');
  const owner = escapeHtml(pkg.owner?.name || 'the owner');
  const updated = escapeHtml(pkg.meta?.updated || '');
  const steps = person?.access_path?.steps || [];
  const stepsHtml = steps.map((st, i) => {
    const ref = st.ref_id && pkg.entity(st.ref_id) ? `<div class="ref">→ ${escapeHtml(pkg.name(st.ref_id))}</div>` : '';
    const photo = st.photo_id && pkg.attachmentUrls[st.photo_id]
      ? `<img src="${escapeHtml(pkg.attachmentUrls[st.photo_id])}" alt="" />` : '';
    return `<li><span class="n">${i + 1}</span><div class="b"><div class="t">${escapeHtml(st.text || '')}</div>${ref}${photo}</div></li>`;
  }).join('');
  w.document.write(`<!doctype html>
    <html><head><title>For ${name}</title>
    <style>
      body { font-family: ui-monospace, Menlo, monospace; color: #222; max-width: 660px; margin: 40px auto; padding: 0 24px; line-height: 1.55; }
      .head-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #666; }
      .updated { font-size: 12px; color: #777; white-space: nowrap; }
      h1 { font-weight: 300; font-size: 30px; margin: 8px 0 26px; }
      ol { list-style: none; padding: 0; margin: 0; }
      li { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid #ddd; page-break-inside: avoid; }
      .n { flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid #3C6FB2; color: #3C6FB2; font-weight: 600; font-size: 13px; }
      .t { font-size: 15px; }
      .ref { color: #3C6FB2; font-size: 13px; margin-top: 4px; }
      img { max-width: 320px; max-height: 220px; display: block; margin-top: 8px; border: 1px solid #ddd; }
      .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 12px; color: #777; }
    </style></head>
    <body onload="setTimeout(() => { window.focus(); window.print(); }, 150)">
      <div class="head-row">
        <div class="eyebrow">Open only if something has happened to ${owner}</div>
        <div class="updated">Last updated: ${updated}</div>
      </div>
      <h1>For ${name}</h1>
      <ol>${stepsHtml}</ol>
      <div class="foot">Always use the copy with the newest date.</div>
    </body></html>`);
  w.document.close();
}
