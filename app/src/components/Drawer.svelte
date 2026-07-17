<script>
  import EntityList from './EntityList.svelte';
  import PersonForm from './PersonForm.svelte';
  import LocationForm from './LocationForm.svelte';
  import ItemForm from './ItemForm.svelte';
  import GuideForm from './GuideForm.svelte';
  import AttachmentForm from './AttachmentForm.svelte';
  import RoleForm from './RoleForm.svelte';
  import ReadinessForm from './ReadinessForm.svelte';
  import MetaForm from './MetaForm.svelte';
  import MapForm from './MapForm.svelte';
  import Prose from './Prose.svelte';
  import StatusIcon from './StatusIcon.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import { lockBodyScroll } from '../lib/scrollLock.js';

  let { pkg, id, onOpen, onClose, onBack = null, canBack = false, store = null, editing = false, showReadiness = false, onDelete = null, onTag = null, onView = null, requestConfirm = null, requestNotice = null } = $props();

  $effect(() => lockBodyScroll());

  let full = $state(false); // expand the side panel to near full-screen (e.g. to read a PDF)
  let openSections = $state({});

  const e = $derived(pkg.entity(id));
  const obj = $derived(e?.obj);
  const runId = $derived(String(id || '').startsWith('__run:') ? String(id).slice(6) : null);
  const testRun = $derived(runId ? (store?.data?.readiness_runs || []).find((r) => r.id === runId) : null);
  const impLabel = (l) => ({ high: 'High', medium: 'Medium', low: 'Low' }[l] || l);
  const sectionOpen = (key, count) => count <= 3 || !!openSections[key];
  function toggleSection(key) {
    openSections = { ...openSections, [key]: !openSections[key] };
  }
  const runOpen = (runId) => !!openSections[`run:${runId}`];
  function toggleRun(runId) {
    toggleSection(`run:${runId}`);
  }

  const dependents = $derived(e?.kind === 'item' ? (pkg.dependentsOf.get(id) || []) : []);
  const itemsHere = $derived(e?.kind === 'location' ? (pkg.itemsAtLocation.get(id) || []) : []);
  const itemsAccess = $derived(e?.kind === 'person' ? (pkg.itemsAccessibleBy.get(id) || []) : []);
  const locationDependsOnIds = $derived.by(() => {
    if (e?.kind !== 'location') return [];
    return [...new Set(obj.depends_on_ids || [])];
  });
  const attachmentsForItem = $derived.by(() => {
    if (e?.kind !== 'item') return [];
    const ids = new Set(obj.attachment_ids || []);
    for (const a of pkg.attachments || []) {
      if ((a.item_ids || []).includes(id) || a.item_id === id) ids.add(a.id);
    }
    return [...ids];
  });
  // Show image attachments inline (a photo is worth far more than a filename);
  // other files stay as openable rows.
  const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  const attIsImage = (aid) => {
    const a = pkg.entity(aid)?.obj;
    return !!(a && pkg.attachmentUrls[aid] && ((a.mime || '').startsWith('image/') || IMG_EXT.test(a.path || a.filename || '')));
  };
  const itemImages = $derived(attachmentsForItem.filter(attIsImage));
  const itemOtherFiles = $derived(attachmentsForItem.filter((aid) => !attIsImage(aid)));
  // Containment: the container items this item sits in, and what it holds.
  const itemContainers = $derived(e?.kind === 'item' ? (obj.container_ids || []) : []);
  const itemsInside = $derived(e?.kind === 'item' ? (pkg.itemsInContainer.get(id) || []) : []);
  // Full ancestor path (root → parent) for a location, e.g. Country › City › Home.
  const path = $derived(e?.kind === 'location' ? pkg.locationPath(id) : []);
  const attUrl = $derived(e?.kind === 'attachment' ? pkg.attachmentUrls[id] : null);
  const attachmentParentIds = $derived.by(() => {
    if (e?.kind !== 'attachment') return [];
    return [...new Set([...(obj.item_ids || []), ...(obj.guide_ids || []), obj.item_id, obj.guide_id].filter(Boolean))];
  });
  const rolePeopleIds = $derived(
    e?.kind === 'role' ? (pkg.people || []).filter((p) => (p.roles || []).includes(id)).map((p) => p.id) : []
  );
  const roleGuideIds = $derived(
    e?.kind === 'role' ? (pkg.guides || []).filter((g) => (g.audience_roles || []).includes(id)).map((g) => g.id) : []
  );
  const readinessRelatedIds = $derived.by(() => {
    if (e?.kind !== 'readiness') return [];
    return [
      ...(obj.related_person_ids || []),
      ...(obj.related_item_ids || []),
      ...(obj.related_location_ids || []),
      ...(obj.related_guide_ids || []),
      ...(obj.related_attachment_ids || [])
    ];
  });
  const readinessRunResults = $derived.by(() => {
    if (e?.kind !== 'readiness') return [];
    return (store?.data?.readiness_runs || [])
      .map((run) => ({ run, result: (run.results || []).find((r) => r.check_id === id) }))
      .filter((r) => r.result)
      .sort((a, b) => {
        const at = Date.parse(a.run.submitted_at || a.run.started_at || a.run.date || '');
        const bt = Date.parse(b.run.submitted_at || b.run.started_at || b.run.date || '');
        if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
        return String(b.run.date || '').localeCompare(String(a.run.date || ''));
      });
  });
  const pathSteps = $derived(e?.kind === 'person' ? (obj?.access_path?.steps || []) : []);

  // The envelope insert: a printable one-pager of this person's access path.
  function printAccessPath() {
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) return;
    const name = escapeHtml(obj.name || 'you');
    const owner = escapeHtml(pkg.owner?.name || 'the owner');
    const updated = escapeHtml(pkg.meta?.updated || '');
    const stepsHtml = pathSteps.map((st, i) => {
      const ref = st.ref_id && pkg.entity(st.ref_id) ? `<div class="ref">→ ${escapeHtml(pkg.name(st.ref_id))}</div>` : '';
      const photo = st.photo_id && pkg.attachmentUrls[st.photo_id]
        ? `<img src="${escapeHtml(pkg.attachmentUrls[st.photo_id])}" alt="" />` : '';
      return `<li><span class="n">${i + 1}</span><div class="b"><div class="t">${escapeHtml(st.text || '')}</div>${ref}${photo}</div></li>`;
    }).join('');
    w.document.write(`<!doctype html>
      <html><head><title>For ${name}</title>
      <style>
        body { font-family: ui-monospace, Menlo, monospace; color: #222; max-width: 660px; margin: 40px auto; padding: 0 24px; line-height: 1.55; }
        .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #666; }
        h1 { font-weight: 300; font-size: 30px; margin: 8px 0 4px; }
        .calm { color: #555; margin: 10px 0 26px; }
        ol { list-style: none; padding: 0; margin: 0; }
        li { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid #ddd; page-break-inside: avoid; }
        .n { flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid #3C6FB2; color: #3C6FB2; font-weight: 600; font-size: 13px; }
        .t { font-size: 15px; }
        .ref { color: #3C6FB2; font-size: 13px; margin-top: 4px; }
        img { max-width: 320px; max-height: 220px; display: block; margin-top: 8px; border: 1px solid #ddd; }
        .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 12px; color: #777; }
      </style></head>
      <body onload="setTimeout(() => { window.focus(); window.print(); }, 150)">
        <div class="eyebrow">Open only if something has happened to ${owner}</div>
        <h1>For ${name}</h1>
        <p class="calm">Take your time. Everything important is designed to wait. When you are ready, follow these steps in order — and if you are unsure at any point, stop and call the person this plan names first.</p>
        <ol>${stepsHtml}</ol>
        <div class="foot">Last updated: ${updated} · Always use the copy with the newest date.</div>
      </body></html>`);
    w.document.close();
  }

  const testerName = (run) => run.person_id ? pkg.name(run.person_id) : 'Admin';
  const durationLabel = (ms) => {
    if (!ms) return 'Not recorded';
    const sec = Math.max(1, Math.round(ms / 1000));
    if (sec < 60) return `${sec} sec`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem ? `${min} min ${rem} sec` : `${min} min`;
  };
  function testName(run) {
    const iso = run?.submitted_at || run?.started_at;
    if (!iso) return run?.date || 'Missing test';
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (_) {
      return `${run?.date || 'No date'} ${String(iso).slice(11, 16)}`;
    }
  }
  function checkAppliesToPerson(check, personId, personObj) {
    if ((check.scope || 'external') !== 'external') return false;
    if ((check.person_ids || []).includes(personId)) return true;
    if ((check.role_ids || []).some((r) => (personObj?.roles || []).includes(r))) return true;
    return !(check.person_ids || []).length && !(check.role_ids || []).length;
  }
  const personReadiness = $derived.by(() => {
    if (e?.kind !== 'person' || !showReadiness) return { checks: [], runs: [] };
    const runs = (store?.data?.readiness_runs || [])
      .filter((run) => run.person_id === id)
      .sort((a, b) => {
        const at = Date.parse(a.submitted_at || a.started_at || a.date || '');
        const bt = Date.parse(b.submitted_at || b.started_at || b.date || '');
        if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
    const checks = pkg.readinessOrdered().filter((c) => checkAppliesToPerson(c, id, obj));
    return { checks, runs };
  });

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  function printAttachment() {
    if (!attUrl || !obj) return;
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    const title = escapeHtml(obj.filename || 'Attachment');
    const src = escapeHtml(attUrl);
    const isImage = (obj.mime || '').startsWith('image/');
    const media = isImage
      ? `<img src="${src}" alt="${title}" onload="setTimeout(() => { window.focus(); window.print(); }, 100)" />`
      : `<iframe src="${src}" title="${title}" onload="setTimeout(() => { window.focus(); window.print(); }, 100)"></iframe>`;

    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            html, body { margin: 0; min-height: 100%; background: #fff; }
            body { display: grid; place-items: center; }
            img { max-width: 100%; max-height: 100vh; object-fit: contain; }
            iframe { width: 100vw; height: 100vh; border: 0; }
            @media print { body { display: block; } img { width: 100%; max-height: none; } }
          </style>
        </head>
        <body>${media}</body>
      </html>`);
    printWindow.document.close();
  }
  async function deleteResult(runId, checkId) {
    const ok = requestConfirm ? await requestConfirm({
      title: 'Delete dry-run answer?',
      message: 'This removes this one answer and its notes from the test run.',
      confirmLabel: 'Delete'
    }) : true;
    if (ok) store?.deleteReadinessResult?.(runId, checkId);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="scrim" onclick={onClose} role="presentation"></div>
<div class="drawer" class:full role="dialog" aria-modal="true" aria-label="Details" tabindex="-1">
  {#snippet headActions()}
    <div class="dhead-actions">
      <button class="iconbtn" onclick={() => (full = !full)} data-tip={full ? 'Shrink panel' : 'Expand panel'} data-tip-pos="left" aria-label={full ? 'Shrink panel' : 'Expand panel'}>
        {#if full}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
        {/if}
      </button>
      <button class="iconbtn" onclick={onClose} data-tip="Close" data-tip-pos="left" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  {/snippet}
  {#snippet fieldHead(key, label, count = 0)}
    <div class="field-head">
      {#if count > 3}
        <button class="iconbtn collapse-toggle" onclick={() => toggleSection(key)} aria-label={sectionOpen(key, count) ? `Collapse ${label}` : `Expand ${label}`} data-tip={sectionOpen(key, count) ? 'Collapse' : 'Expand'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if sectionOpen(key, count)}<polyline points="6 9 12 15 18 9" />{:else}<polyline points="9 18 15 12 9 6" />{/if}
          </svg>
        </button>
      {/if}
      <span class="muted small">{label}</span>
      {#if count > 0}<span class="field-count">{count}</span>{/if}
    </div>
  {/snippet}
  {#if id === '__meta'}
    <div class="dhead">
      <div><span class="eyebrow">Settings</span><h2>Plan settings</h2></div>
      {@render headActions()}
    </div>
    <MetaForm {pkg} {store} raw={store?.data?.package} {requestConfirm} {requestNotice} />
  {:else if id === '__map'}
    <div class="dhead">
      <div><span class="eyebrow">Map</span><h2>Map settings</h2></div>
      {@render headActions()}
    </div>
    <MapForm {pkg} raw={store?.data?.package} />
  {:else if runId}
    <div class="dhead">
      <div class="dhead-main">
        {#if canBack}
          <button class="iconbtn back" onclick={() => onBack?.()} data-tip="Back" data-tip-pos="right" aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        {/if}
        <div><span class="eyebrow">Test</span><h2>{testRun ? testName(testRun) : 'Missing test'}</h2></div>
      </div>
      {@render headActions()}
    </div>
    {#if testRun}
      <div class="dbody stack">
        <div class="field"><span class="muted small">Person</span><p class="soft small">{testerName(testRun)}</p></div>
        <div class="field"><span class="muted small">Duration</span><p class="soft small">{durationLabel(testRun.duration_ms)}</p></div>
        <div class="field">
          {@render fieldHead(`test-results:${runId}`, 'Answers', (testRun.results || []).length)}
          {#if (testRun.results || []).length}
            {#if sectionOpen(`test-results:${runId}`, (testRun.results || []).length)}
              <div class="result-list">
                {#each testRun.results || [] as result}
                  <div class="result-row">
                    <StatusIcon status={result.status} wrapped />
                    <span class="result-main">
                      <strong>{pkg.name(result.check_id)}</strong>
                      {#if result.notes}<p class="soft small">{result.notes}</p>{/if}
                    </span>
                    <button class="iconbtn danger mini-danger" data-tip="Delete answer" data-tip-pos="left" aria-label="Delete answer" onclick={() => deleteResult(testRun.id, result.check_id)}><TrashIcon size={12} /></button>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <p class="soft small">No answers recorded in this test.</p>
          {/if}
        </div>
      </div>
    {:else}
      <p class="soft">This test no longer exists.</p>
    {/if}
  {:else if !e}
    <div class="dhead">
      <span class="eyebrow">Missing reference</span>
      {@render headActions()}
    </div>
    <p class="soft">This plan refers to <code>{id}</code>, but it isn’t in the plan.</p>
  {:else}
    <div class="dhead">
      <div class="dhead-main">
        {#if canBack}
          <button class="iconbtn back" onclick={() => onBack?.()} data-tip="Back" data-tip-pos="right" aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        {/if}
        <div>
        <span class="eyebrow">
          {#if e.kind === 'person'}Person
          {:else if e.kind === 'location'}Location
          {:else if e.kind === 'item'}Item
          {:else if e.kind === 'attachment'}Attachment
          {:else if e.kind === 'role'}Role
          {:else if e.kind === 'readiness'}Readiness
          {:else if e.kind === 'guide'}Guide settings
          {:else}{e.kind}{/if}
        </span>
        <h2>{pkg.name(id)}</h2>
        </div>
      </div>
      {@render headActions()}
    </div>

    {#if editing}
      {#if e.kind === 'person'}
        <PersonForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'location'}
        <LocationForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'item'}
        <ItemForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'guide'}
        <GuideForm {pkg} {store} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'attachment'}
        <AttachmentForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'role'}
        <RoleForm {pkg} {store} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'readiness'}
        <ReadinessForm {pkg} {store} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else}
        {@const fraw = store?.rawById(id)}
        <div class="frm">
          <label class="f"><span class="lbl">Name</span><input bind:value={fraw.name} /></label>
          <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.(id)}>Delete</button></div>
        </div>
      {/if}
    {:else}
    <div class="dbody stack">
      <!-- Human summary first: name (header) → description → attachments → notes. -->
      {#if obj.display_as}<p class="soft"><span class="muted">Known as</span> {obj.display_as}</p>{/if}
      {#if obj.description}<p class="soft small">{obj.description}</p>{/if}
      {#if e.kind === 'item' && attachmentsForItem.length}
        <div class="field">
          {@render fieldHead(`att:${id}`, 'Attachments', attachmentsForItem.length)}
          {#if sectionOpen(`att:${id}`, attachmentsForItem.length)}
            {#each itemImages as aid (aid)}
              {@const a = pkg.entity(aid)?.obj}
              <button class="att-figure" onclick={() => onOpen?.(aid)} title={a?.description || a?.filename || 'Open file'}>
                <img class="att-img" src={pkg.attachmentUrls[aid]} alt={a?.description || a?.filename || ''} loading="lazy" />
                {#if a?.description}<span class="att-cap tiny muted">{a.description}</span>{/if}
              </button>
            {/each}
            {#if itemOtherFiles.length}<EntityList {pkg} ids={itemOtherFiles} {onOpen} />{/if}
          {/if}
        </div>
      {/if}
      {#if obj.notes}<div class="field"><span class="muted small">Notes</span><div class="notes-prose"><Prose {pkg} markdown={obj.notes} {onOpen} {onTag} {onView} /></div></div>{/if}

      <!-- READINESS -->
      {#if e.kind === 'readiness'}
        <div class="field"><span class="muted small">{obj.scope === 'internal' ? 'Task / gap' : 'Question / task'}</span>
          <div class="notes-prose"><Prose {pkg} markdown={obj.scope === 'internal' ? (obj.owner_notes || '') : (obj.question || '')} {onOpen} {onTag} {onView} /></div>
        </div>
        {#if obj.scope !== 'internal' && obj.expected}
          <div class="field"><span class="muted small">What a good answer proves</span><p class="soft small">{obj.expected}</p></div>
        {/if}
        {#if obj.person_ids?.length}
          <div class="field">
            {@render fieldHead(`ready-people:${id}`, 'Assigned people', obj.person_ids.length)}
            {#if sectionOpen(`ready-people:${id}`, obj.person_ids.length)}<EntityList {pkg} ids={obj.person_ids} {onOpen} />{/if}
          </div>
        {/if}
        {#if obj.tags?.length}
          <div class="field"><span class="muted small">Tags</span>
            <div class="row wrap">{#each obj.tags as tag}<span class="chip"># {tag}</span>{/each}</div>
          </div>
        {/if}
        {#if readinessRelatedIds.length}
          <div class="field">
            {@render fieldHead(`ready-related:${id}`, 'Related', readinessRelatedIds.length)}
            {#if sectionOpen(`ready-related:${id}`, readinessRelatedIds.length)}<EntityList {pkg} ids={readinessRelatedIds} {onOpen} />{/if}
          </div>
        {/if}
        <div class="field">
          {@render fieldHead(`ready-results:${id}`, 'Dry-run results', readinessRunResults.length)}
          {#if readinessRunResults.length}
            {#if sectionOpen(`ready-results:${id}`, readinessRunResults.length)}<div class="result-list">
              {#each readinessRunResults as rr (rr.run.id)}
                <div class="result-row">
                  <StatusIcon status={rr.result.status} wrapped />
                  <span class="result-main">
                    <span class="muted small">{testerName(rr.run)} · {testName(rr.run)}</span>
                    {#if rr.result.notes}<p class="soft small">{rr.result.notes}</p>{/if}
                  </span>
                  <button class="iconbtn danger mini-danger" data-tip="Delete answer" data-tip-pos="left" aria-label="Delete answer" onclick={() => deleteResult(rr.run.id, rr.result.check_id)}><TrashIcon size={12} /></button>
                </div>
              {/each}
            </div>{/if}
          {:else}
            <p class="soft small">No dry-run results yet.</p>
          {/if}
        </div>
      {/if}

      <!-- Importance gets a titled section like every other field; sensitive stays a chip. -->
      {#if obj.importance && e.kind !== 'person'}
        <div class="field"><span class="muted small">Importance</span>
          <p class="soft small">{impLabel(obj.importance)}</p>
        </div>
      {/if}
      {#if obj.sensitive}
        <div class="row wrap"><span class="chip caution-chip">● sensitive</span></div>
      {/if}

      <!-- ROLE -->
      {#if e.kind === 'role'}
        {#if rolePeopleIds.length}
          <div class="field">
            {@render fieldHead(`role-people:${id}`, 'Assigned people', rolePeopleIds.length)}
            {#if sectionOpen(`role-people:${id}`, rolePeopleIds.length)}<EntityList {pkg} ids={rolePeopleIds} {onOpen} />{/if}
          </div>
        {:else}
          <p class="soft small">No people are assigned to this role.</p>
        {/if}
        {#if roleGuideIds.length}
          <div class="field">
            {@render fieldHead(`role-guides:${id}`, 'Used by guides', roleGuideIds.length)}
            {#if sectionOpen(`role-guides:${id}`, roleGuideIds.length)}<EntityList {pkg} ids={roleGuideIds} {onOpen} />{/if}
          </div>
        {:else}
          <p class="soft small">No guides use this role.</p>
        {/if}
      {/if}

      <!-- PERSON -->
      {#if e.kind === 'person'}
        {#if obj.nickname && obj.name}<div class="field"><span class="muted small">Full name</span><p class="soft">{obj.name}</p></div>{/if}
        {#if obj.roles?.length}
          <div class="field"><span class="muted small">Role</span>
            <div class="row wrap">{#each obj.roles as r}<span class="chip">{pkg.roleLabel(r)}</span>{/each}</div>
          </div>
        {/if}
        {#if showReadiness && obj.readiness_score}
          <div class="field"><span class="muted small">Readiness score</span><p class="soft small">{obj.readiness_score}</p></div>
        {/if}
        {#if obj.contacts?.length}
          <div class="field"><span class="muted small">Contact</span>
            <ul class="plain small">
              {#each obj.contacts as c}
                <li><span class="muted">{c.method}:</span>
                  {#if c.method === 'url' || c.method === 'linkedin'}<a href={c.value} target="_blank" rel="noopener noreferrer">{c.value}</a>
                  {:else if c.method === 'email'}<a href={'mailto:' + c.value}>{c.value}</a>
                  {:else}{c.value}{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if obj.verification}
          <div class="caution">
            <strong>Confirm their identity first.</strong>
            <div class="small" style="margin-top:6px">Ask: “{obj.verification.question}”</div>
            {#if obj.verification.answer_hint}<div class="small muted" style="margin-top:4px">Expected: {obj.verification.answer_hint}</div>{/if}
          </div>
        {/if}
        {#if pathSteps.length}
          <div class="field">
            {@render fieldHead(`person-path:${id}`, 'Access path', pathSteps.length)}
            {#if sectionOpen(`person-path:${id}`, pathSteps.length)}
              <ol class="path">
                {#each pathSteps as st, i (st.id || i)}
                  <li class="path-step">
                    <span class="path-num">{i + 1}</span>
                    <div class="path-body">
                      {#if st.text}<div class="path-text">{st.text}</div>{/if}
                      {#if st.ref_id && pkg.entity(st.ref_id)}
                        <button class="path-ref" onclick={() => onOpen?.(st.ref_id)}>{pkg.name(st.ref_id)}</button>
                      {/if}
                      {#if st.photo_id && pkg.attachmentUrls[st.photo_id]}
                        <button class="att-figure path-photo" onclick={() => onOpen?.(st.photo_id)} title="Open photo">
                          <img class="att-img" src={pkg.attachmentUrls[st.photo_id]} alt={pkg.name(st.photo_id)} loading="lazy" />
                        </button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ol>
              <button class="btn btn-small path-print no-print" onclick={printAccessPath}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                Print the envelope insert
              </button>
            {/if}
          </div>
        {/if}
        {#if itemsAccess.length}
          <div class="field">
            {@render fieldHead(`person-access:${id}`, 'Can access', itemsAccess.length)}
            {#if sectionOpen(`person-access:${id}`, itemsAccess.length)}<EntityList {pkg} ids={itemsAccess} {onOpen} />{/if}
          </div>
        {/if}
        {#if showReadiness}
          <div class="field">
            {@render fieldHead(`person-readiness:${id}`, 'Readiness answers', personReadiness.runs.length)}
            {#if personReadiness.runs.length}
              {#if sectionOpen(`person-readiness:${id}`, personReadiness.runs.length)}<div class="runs">
                {#each personReadiness.runs as run (run.id)}
                  <div class="run-block">
                    <button class="run-head" onclick={() => toggleRun(run.id)} aria-expanded={runOpen(run.id)}>
                      <span class="run-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          {#if runOpen(run.id)}<polyline points="6 9 12 15 18 9" />{:else}<polyline points="9 18 15 12 9 6" />{/if}
                        </svg>
                        <strong>{testName(run)}</strong>
                      </span>
                      <span class="muted small">{(run.results || []).length} result{(run.results || []).length === 1 ? '' : 's'}</span>
                    </button>
                    {#if runOpen(run.id)}
                      {#each run.results || [] as result}
                        <div class="result-row">
                          <StatusIcon status={result.status} wrapped />
                          <span class="result-main">
                            <strong>{pkg.name(result.check_id)}</strong>
                            {#if result.notes}<p class="soft small">{result.notes}</p>{/if}
                          </span>
                          <button class="iconbtn danger mini-danger" data-tip="Delete answer" data-tip-pos="left" aria-label="Delete answer" onclick={() => deleteResult(run.id, result.check_id)}><TrashIcon size={12} /></button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/each}
              </div>{/if}
            {:else}
              <p class="soft small">No dry-run answers recorded for this person yet.</p>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- LOCATION -->
      {#if e.kind === 'location'}
        {#if path.length}
          <div class="field"><span class="muted small">Inside</span>
            <div class="breadcrumb">
              {#each path as anc, i}
                <button class="crumb" onclick={() => onOpen?.(anc.id)}>{anc.name}</button>{#if i < path.length - 1}<span class="crumb-sep">›</span>{/if}
              {/each}
            </div>
          </div>
        {/if}
        {#if obj.access_person_ids?.length}
          <div class="field">
            {@render fieldHead(`loc-access:${id}`, 'Who can access it', obj.access_person_ids.length)}
            {#if sectionOpen(`loc-access:${id}`, obj.access_person_ids.length)}<EntityList {pkg} ids={obj.access_person_ids} {onOpen} />{/if}
          </div>
        {/if}
        {#if locationDependsOnIds.length}
          <div class="field">
            {@render fieldHead(`loc-depends:${id}`, 'Depends on', locationDependsOnIds.length)}
            {#if sectionOpen(`loc-depends:${id}`, locationDependsOnIds.length)}<EntityList {pkg} ids={locationDependsOnIds} {onOpen} />{/if}
          </div>
        {/if}
        {#if itemsHere.length}
          <div class="field">
            {@render fieldHead(`loc-items:${id}`, 'What is stored here', itemsHere.length)}
            {#if sectionOpen(`loc-items:${id}`, itemsHere.length)}<EntityList {pkg} ids={itemsHere} {onOpen} />{/if}
          </div>
        {/if}
      {/if}

      <!-- ITEM -->
      {#if e.kind === 'item'}
        {#if obj.location_ids?.length}
          <div class="field">
            {@render fieldHead(`item-locations:${id}`, 'Where it is', obj.location_ids.length)}
            {#if sectionOpen(`item-locations:${id}`, obj.location_ids.length)}<EntityList {pkg} ids={obj.location_ids} {onOpen} />{/if}
          </div>
        {/if}
        {#if itemContainers.length}
          <div class="field">
            {@render fieldHead(`item-containers:${id}`, 'Stored inside', itemContainers.length)}
            {#if sectionOpen(`item-containers:${id}`, itemContainers.length)}<EntityList {pkg} ids={itemContainers} {onOpen} />{/if}
          </div>
        {/if}
        {#if itemsInside.length}
          <div class="field">
            {@render fieldHead(`item-inside:${id}`, "What's inside", itemsInside.length)}
            {#if sectionOpen(`item-inside:${id}`, itemsInside.length)}<EntityList {pkg} ids={itemsInside} {onOpen} />{/if}
          </div>
        {/if}
        {#if obj.access_person_ids?.length}
          <div class="field">
            {@render fieldHead(`item-access:${id}`, 'Who can access', obj.access_person_ids.length)}
            {#if sectionOpen(`item-access:${id}`, obj.access_person_ids.length)}<EntityList {pkg} ids={obj.access_person_ids} {onOpen} />{/if}
          </div>
        {/if}
        {#if obj.depends_on_ids?.length}
          <div class="field">
            {@render fieldHead(`item-depends:${id}`, 'Depends on', obj.depends_on_ids.length)}
            {#if sectionOpen(`item-depends:${id}`, obj.depends_on_ids.length)}<EntityList {pkg} ids={obj.depends_on_ids} {onOpen} />{/if}
          </div>
        {/if}
        {#if dependents.length}
          <div class="field">
            {@render fieldHead(`item-needed:${id}`, 'Needed by', dependents.length)}
            {#if sectionOpen(`item-needed:${id}`, dependents.length)}<EntityList {pkg} ids={dependents} {onOpen} />{/if}
          </div>
        {/if}
        {#if obj.price}
          <div class="field"><span class="muted small">Price</span><p class="soft small">{obj.price}</p></div>
        {/if}
        {#if obj.guide_ids?.length}
          <div class="field">
            {@render fieldHead(`item-guides:${id}`, 'Explained in', obj.guide_ids.length)}
            {#if sectionOpen(`item-guides:${id}`, obj.guide_ids.length)}<EntityList {pkg} ids={obj.guide_ids} {onOpen} />{/if}
          </div>
        {/if}
      {/if}

      <!-- ATTACHMENT -->
      {#if e.kind === 'attachment'}
        {#if obj.path}<div class="field"><span class="muted small">Path</span><p class="soft small">{obj.path}</p></div>{/if}
        {#if attUrl}
          {#if (obj.mime || '').startsWith('image/')}
            <img class="att-img" src={attUrl} alt={obj.description || obj.filename} />
          {:else if (obj.mime || '') === 'application/pdf' || /\.pdf$/i.test(obj.path || obj.filename || '')}
            <!-- The browser's built-in PDF viewer — no library needed. -->
            <iframe class="att-pdf no-print" src={`${attUrl}#toolbar=0&navpanes=0&view=FitH`} title={obj.description || obj.filename}></iframe>
          {/if}
        {:else}
          <p class="soft small">File <code>{obj.path}</code> is referenced but wasn’t found in the opened file
            (open the whole folder/zip to include it).</p>
        {/if}
        {#if attachmentParentIds.length}
          <div class="field">
            {@render fieldHead(`att-parents:${id}`, 'Attached to', attachmentParentIds.length)}
            {#if sectionOpen(`att-parents:${id}`, attachmentParentIds.length)}<EntityList {pkg} ids={attachmentParentIds} {onOpen} />{/if}
          </div>
        {/if}
        {#if attUrl}
          <div class="attachment-actions row wrap">
            <a class="btn btn-primary" href={attUrl} download={obj.filename}>Download</a>
            <button class="iconbtn" onclick={printAttachment} data-tip="Print this file" data-tip-pos="left" aria-label="Print">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </button>
          </div>
        {/if}
      {/if}
    </div>
    {/if}
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: var(--z-drawer);
    width: clamp(380px, 44vw, 680px);
    background: var(--paper);
    border-left: 1px solid var(--rule);
    box-shadow: -24px 0 60px oklch(0.2 0.03 255 / 0.16);
    overflow-y: auto;
    padding: 20px 22px 60px;
    animation: slide .18s ease;
    transition: width .2s ease;
  }
  .drawer.full { width: 94vw; }
  .dhead-actions { display: flex; align-items: center; gap: 6px; flex: none; }
  @keyframes slide { from { transform: translateX(20px); opacity: .6; } to { transform: none; opacity: 1; } }
  .dhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dhead-main { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .dhead h2 { margin-top: 4px; font-size: 24px; }
  /* The drawer is nearly full-width on phones (380px min, ~336px after its own
     padding) — 24px bold tips a mid-length title onto a second line. */
  @media (max-width: 480px) { .dhead h2 { font-size: 20px; } }
  .back { width: 32px; height: 32px; margin-top: 2px; }
  /* One consistent text size across the whole panel body (values, list rows,
     breadcrumbs…). The header title and the small uppercase field labels keep
     their own sizes. */
  .dbody { margin-top: 18px; font-size: 13px; }
  .dbody :global(.ulist-name) { font-size: 13px; }
  /* Productboard-style divided field rows for scannability. */
  .field { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--rule-soft); }
  .field:first-child { padding-top: 0; border-top: none; }
  .field > .muted { font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-mute); }
  .field-head { display: flex; align-items: center; gap: 8px; min-height: 22px; }
  .field-head .muted { font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-mute); }
  .collapse-toggle { width: 24px; height: 24px; }
  .field-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border: 1px solid var(--rule);
    border-radius: 4px;
    color: var(--ink-mute);
    font-size: 11px;
    line-height: 1;
    background: var(--paper);
  }
  /* Notes render as rich prose (formatting + mentions), sized to match the
     other panel text (description, importance…). */
  .notes-prose :global(.prose) { font-size: 13px; line-height: 1.6; }
  .notes-prose :global(.prose) :global(p:first-child) { margin-top: 0; }
  .result-list { display: flex; flex-direction: column; gap: 8px; }
  .result-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 24px;
    column-gap: 14px;
    align-items: center;
    padding: 6px 0;
  }
  .result-main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .result-main strong { line-height: 1.35; }
  .result-row p { margin: 0; white-space: pre-wrap; }
  .runs { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .run-block { padding-top: 10px; border-top: 1px solid var(--rule-soft); }
  .run-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; padding: 4px 0; text-align: left; color: var(--ink); }
  .run-title { display: inline-flex; align-items: center; gap: 8px; }
  .mini-danger { width: 24px; height: 24px; align-self: center; }
  .breadcrumb { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; }
  .path { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
  .path-step { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rule-soft); }
  .path-step:first-child { border-top: none; padding-top: 2px; }
  .path-num { flex: none; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; background: var(--accent-wash); color: var(--accent-deep); font-size: 12px; font-weight: 600; }
  .path-body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .path-text { font-size: 13px; }
  .path-ref { align-self: flex-start; font-size: 12.5px; color: var(--accent-deep); text-decoration: underline; text-underline-offset: 3px; padding: 0; }
  .path-photo { max-width: 260px; }
  .path-print { align-self: flex-start; margin-top: 10px; }
  .crumb { font-size: 13px; color: var(--accent-deep); padding: 1px 2px; border-radius: 4px; }
  .crumb:hover { text-decoration: underline; text-underline-offset: 3px; }
  .crumb-sep { color: var(--ink-mute); margin: 0 4px; }
  .plain { list-style: none; padding: 0; }
  .plain li + li { margin-top: 4px; }
  .caution-chip { color: var(--warn); border-color: oklch(0.85 0.06 50); }
  .att-img { width: 100%; border-radius: 0; border: 1px solid var(--rule-soft); margin-top: 16px; margin-bottom: 12px; display: block; }
  .att-pdf { width: 100%; min-height: 78vh; border-radius: 0; border: 1px solid var(--rule-soft); margin-top: 16px; margin-bottom: 12px; background: var(--paper); }
  /* Inline image attachment in an item's read view — clickable to open full. */
  .att-figure { display: block; width: 100%; padding: 0; border: none; background: none; text-align: left; cursor: pointer; }
  .att-figure .att-img { border-radius: 0; }
  .att-figure:hover .att-img { border-color: var(--accent); }
  .att-cap { display: block; margin: -6px 0 12px; }
</style>
