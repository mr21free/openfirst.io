<script>
  import EntityList from './EntityList.svelte';
  import PersonForm from './PersonForm.svelte';
  import LocationForm from './LocationForm.svelte';
  import ItemForm from './ItemForm.svelte';
  import GuideForm from './GuideForm.svelte';
  import AttachmentForm from './AttachmentForm.svelte';
  import RoleForm from './RoleForm.svelte';
  import MetaForm from './MetaForm.svelte';

  let { pkg, id, onOpen, onClose, onBack = null, canBack = false, store = null, editing = false, onDelete = null, requestConfirm = null, requestNotice = null } = $props();

  let full = $state(false); // expand the side panel to near full-screen (e.g. to read a PDF)

  const e = $derived(pkg.entity(id));
  const obj = $derived(e?.obj);
  const impLabel = (l) => ({ high: 'High', medium: 'Medium', low: 'Low' }[l] || l);

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
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="scrim" onclick={onClose} role="presentation"></div>
<div class="drawer" class:full role="dialog" aria-modal="true" aria-label="Details" tabindex="-1">
  {#snippet headActions()}
    <div class="dhead-actions">
      <button class="btn btn-ghost close" onclick={() => (full = !full)} title={full ? 'Shrink panel' : 'Expand panel'} aria-label={full ? 'Shrink panel' : 'Expand panel'}>{full ? '⤡' : '⤢'}</button>
      <button class="btn btn-ghost close" onclick={onClose} aria-label="Close">✕</button>
    </div>
  {/snippet}
  {#if id === '__meta'}
    <div class="dhead">
      <div><span class="eyebrow">Settings</span><h2>Settings</h2></div>
      {@render headActions()}
    </div>
    <MetaForm {pkg} {store} raw={store?.data?.package} {requestConfirm} {requestNotice} />
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
          <button class="back" onclick={() => onBack?.()} title="Back" aria-label="Back">
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
        <GuideForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'attachment'}
        <AttachmentForm {pkg} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else if e.kind === 'role'}
        <RoleForm {pkg} {store} raw={store?.rawById(id)} onDelete={() => onDelete?.(id)} />
      {:else}
        {@const fraw = store?.rawById(id)}
        <div class="frm">
          <label class="f"><span class="lbl">Name</span><input bind:value={fraw.name} /></label>
          <label class="toggle"><input type="checkbox" bind:checked={fraw.is_print} /> <span>Print folder</span></label>
          <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.(id)}>Delete</button></div>
        </div>
      {/if}
    {:else}
    <div class="dbody stack">
      <!-- Human summary first: name (header) → description → attachments → notes. -->
      {#if obj.display_as}<p class="soft"><span class="muted">Known as</span> {obj.display_as}</p>{/if}
      {#if obj.description}<p class="soft">{obj.description}</p>{/if}
      {#if e.kind === 'item' && attachmentsForItem.length}
        <div class="field"><span class="muted small">Attachments</span>
          {#each itemImages as aid (aid)}
            {@const a = pkg.entity(aid)?.obj}
            <button class="att-figure" onclick={() => onOpen?.(aid)} title={a?.description || a?.filename || 'Open file'}>
              <img class="att-img" src={pkg.attachmentUrls[aid]} alt={a?.description || a?.filename || ''} loading="lazy" />
              {#if a?.description}<span class="att-cap tiny muted">{a.description}</span>{/if}
            </button>
          {/each}
          {#if itemOtherFiles.length}<EntityList {pkg} ids={itemOtherFiles} {onOpen} />{/if}
        </div>
      {/if}
      {#if obj.notes}<div class="field"><span class="muted small">Notes</span><p class="soft small">{obj.notes}</p></div>{/if}

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
          <div class="field"><span class="muted small">Assigned people</span>
            <EntityList {pkg} ids={rolePeopleIds} {onOpen} />
          </div>
        {:else}
          <p class="soft small">No people are assigned to this role.</p>
        {/if}
        {#if roleGuideIds.length}
          <div class="field"><span class="muted small">Used by guides</span>
            <EntityList {pkg} ids={roleGuideIds} {onOpen} />
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
        {#if itemsAccess.length}
          <div class="field"><span class="muted small">Can access</span>
            <EntityList {pkg} ids={itemsAccess} {onOpen} />
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
          <div class="field"><span class="muted small">Who can access it</span>
            <EntityList {pkg} ids={obj.access_person_ids} {onOpen} />
          </div>
        {/if}
        {#if locationDependsOnIds.length}
          <div class="field"><span class="muted small">Depends on</span>
            <EntityList {pkg} ids={locationDependsOnIds} {onOpen} />
          </div>
        {/if}
        {#if itemsHere.length}
          <div class="field"><span class="muted small">What is stored here</span>
            <EntityList {pkg} ids={itemsHere} {onOpen} />
          </div>
        {/if}
      {/if}

      <!-- ITEM -->
      {#if e.kind === 'item'}
        {#if obj.sensitive && obj.secret}
          <div class="caution">
            <strong>Sensitive — {obj.secret.kind}.</strong>
            <div class="secret">{obj.secret.value}</div>
            {#if obj.secret.note}<div class="small muted" style="margin-top:6px">{obj.secret.note}</div>{/if}
          </div>
        {/if}
        {#if obj.location_ids?.length}
          <div class="field"><span class="muted small">Where it is</span>
            <EntityList {pkg} ids={obj.location_ids} {onOpen} />
          </div>
        {/if}
        {#if itemContainers.length}
          <div class="field"><span class="muted small">Stored inside</span>
            <EntityList {pkg} ids={itemContainers} {onOpen} />
          </div>
        {/if}
        {#if itemsInside.length}
          <div class="field"><span class="muted small">What's inside</span>
            <EntityList {pkg} ids={itemsInside} {onOpen} />
          </div>
        {/if}
        {#if obj.access_person_ids?.length}
          <div class="field"><span class="muted small">Who can access</span>
            <EntityList {pkg} ids={obj.access_person_ids} {onOpen} />
          </div>
        {/if}
        {#if obj.depends_on_ids?.length}
          <div class="field"><span class="muted small">Depends on</span>
            <EntityList {pkg} ids={obj.depends_on_ids} {onOpen} />
          </div>
        {/if}
        {#if dependents.length}
          <div class="field"><span class="muted small">Needed by</span>
            <EntityList {pkg} ids={dependents} {onOpen} />
          </div>
        {/if}
        {#if obj.price}
          <div class="field"><span class="muted small">Price</span><p class="soft small">{obj.price}</p></div>
        {/if}
        {#if obj.guide_ids?.length}
          <div class="field"><span class="muted small">Explained in</span>
            <EntityList {pkg} ids={obj.guide_ids} {onOpen} />
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
          <div class="field"><span class="muted small">Attached to</span>
            <EntityList {pkg} ids={attachmentParentIds} {onOpen} />
          </div>
        {/if}
        {#if attUrl}
          <div class="attachment-actions row wrap">
            <a class="btn btn-primary" href={attUrl} download={obj.filename}>Download</a>
            <button class="iconbtn-print" onclick={printAttachment} title="Print" aria-label="Print">
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
  .scrim { position: fixed; inset: 0; background: oklch(0.2 0.03 255 / 0.32); z-index: 60; }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 61;
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
  .dhead-actions { display: flex; align-items: center; gap: 4px; flex: none; }
  @keyframes slide { from { transform: translateX(20px); opacity: .6; } to { transform: none; opacity: 1; } }
  .dhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dhead-main { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .dhead h2 { margin-top: 4px; font-size: 24px; }
  .back {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 8px; flex: none; margin-top: 2px;
    color: var(--ink-soft); border: 1px solid transparent;
  }
  .back:hover { color: var(--ink); border-color: var(--rule); background: var(--paper); }
  .iconbtn-print {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 999px;
    border: 1px solid var(--rule); color: var(--ink-soft);
  }
  .iconbtn-print:hover { color: var(--ink); border-color: var(--accent-deep); }
  .close { min-height: 34px; padding: 4px 10px; }
  .dbody { margin-top: 18px; }
  .field { display: flex; flex-direction: column; gap: 7px; }
  .breadcrumb { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; }
  .crumb { font-size: 14px; color: var(--accent-deep); padding: 1px 2px; border-radius: 4px; }
  .crumb:hover { text-decoration: underline; text-underline-offset: 3px; }
  .crumb-sep { color: var(--ink-mute); margin: 0 4px; }
  .plain { list-style: none; padding: 0; }
  .plain li + li { margin-top: 4px; }
  .caution-chip { color: var(--warn); border-color: oklch(0.85 0.06 50); }
  .secret { font-weight: 600; margin-top: 6px; word-break: break-all; color: var(--ink); }
  .att-img { width: 100%; border-radius: 10px; border: 1px solid var(--rule-soft); margin-top: 16px; margin-bottom: 12px; display: block; }
  .att-pdf { width: 100%; min-height: 78vh; border-radius: 10px; border: 1px solid var(--rule-soft); margin-top: 16px; margin-bottom: 12px; background: var(--paper); }
  /* Inline image attachment in an item's read view — clickable to open full. */
  .att-figure { display: block; width: 100%; padding: 0; border: none; background: none; text-align: left; cursor: pointer; }
  .att-figure:hover .att-img { border-color: var(--accent); }
  .att-cap { display: block; margin: -6px 0 12px; }
</style>
