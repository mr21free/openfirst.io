<script>
  import TrashIcon from './TrashIcon.svelte';
  // Forward: edits `target[key]` directly — an id array (multi) or a single id (single).
  // Reverse (`reverse` + `reverseKey`): edits the *other* entities, toggling this
  //   entity's id inside each one's `[reverseKey]` array. Same UI, set from the
  //   other side (e.g. "what items are stored in this location").
  let { pkg, target, key, kinds = ['person'], single = false, exclude = [], placeholder = 'Add…',
        reverse = false, reverseKey = null } = $props();

  // Entries carry a `depth` so locations list in hierarchical order with an
  // indent ("-" per level); everything else stays flat (depth 0).
  // Natural, case-insensitive name sort so long pick-lists are easy to scan.
  const byName = (a, b) => pkg.name(a.id).localeCompare(pkg.name(b.id), undefined, { numeric: true, sensitivity: 'base' });
  const allEntries = $derived.by(() => {
    const out = [];
    for (const k of kinds) {
      if (k === 'location') {
        // Locations keep their hierarchy (tree order) — not alphabetised.
        for (const { loc, depth } of pkg.locationTreeFlat()) out.push({ id: loc.id, depth });
        continue;
      }
      if (k === 'person') {
        // Primary recipients lead (in set order); everyone else follows A→Z.
        const primary = pkg.primaryRecipientIds();
        const ppl = pkg.people || [];
        const lead = primary.map((id) => ppl.find((p) => p.id === id)).filter(Boolean);
        const rest = ppl.filter((p) => !primary.includes(p.id)).sort(byName);
        for (const o of [...lead, ...rest]) out.push({ id: o.id, depth: 0 });
        continue;
      }
      const base =
        k === 'item' ? pkg.items :
        k === 'guide' ? pkg.guides :
        k === 'folder' ? pkg.folders :
        k === 'attachment' ? pkg.attachments : [];
      for (const o of [...(base || [])].sort(byName)) out.push({ id: o.id, depth: 0 });
    }
    return out;
  });
  const allIds = $derived(allEntries.map((e) => e.id));

  const selectedIds = $derived.by(() => {
    if (reverse) return allIds.filter((id) => (pkg.entity(id)?.obj?.[reverseKey] || []).includes(target?.id));
    return single ? (target?.[key] ? [target[key]] : []) : (target?.[key] || []);
  });

  const optionRows = $derived(allEntries.filter((e) => e.id !== target?.id && !exclude.includes(e.id) && !selectedIds.includes(e.id)));

  function add(id) {
    if (!id) return;
    if (reverse) {
      const o = pkg.entity(id)?.obj;
      if (!o) return;
      if (!Array.isArray(o[reverseKey])) o[reverseKey] = [];
      if (!o[reverseKey].includes(target.id)) o[reverseKey].push(target.id);
      return;
    }
    if (id === '__none') { if (single) delete target[key]; return; }
    if (single) { target[key] = id; return; }
    if (!Array.isArray(target[key])) target[key] = [];
    if (!target[key].includes(id)) target[key].push(id);
  }
  function remove(id) {
    if (reverse) {
      const o = pkg.entity(id)?.obj;
      const i = (o?.[reverseKey] || []).indexOf(target.id);
      if (i >= 0) o[reverseKey].splice(i, 1);
      return;
    }
    if (single) { delete target[key]; return; }
    const i = (target[key] || []).indexOf(id);
    if (i >= 0) target[key].splice(i, 1);
  }

  function sub(id) {
    const e = pkg.entity(id);
    if (!e) return 'missing';
    if (e.kind === 'person') return (e.obj.roles || []).map((r) => pkg.roleLabel(r)).join(', ');
    if (e.kind === 'item') return e.obj.price || ''; // the name already says it's an item
    if (e.kind === 'location') return '';
    if (e.kind === 'guide') return 'guide';
    if (e.kind === 'attachment') return ''; // the filename already says what it is
    return e.kind;
  }
</script>

<div class="picker">
  {#if selectedIds.length}
    <div class="pchips">
      {#each selectedIds as id}
        <span class="pchip"><span>{pkg.name(id)}</span><button class="x" title="Delete" onclick={() => remove(id)}><TrashIcon size={11} /></button></span>
      {/each}
    </div>
  {/if}
  {#if optionRows.length}
    <select value="" onchange={(e) => { add(e.target.value); e.target.value = ''; }}>
      <option value="">{single && selectedIds.length ? 'Change…' : placeholder}</option>
      {#if single && selectedIds.length}<option value="__none">— none</option>{/if}
      {#each optionRows as { id, depth }}<option value={id}>{depth ? '-'.repeat(depth) + ' ' : ''}{pkg.name(id)}{sub(id) ? ` (${sub(id)})` : ''}</option>{/each}
    </select>
  {:else if !selectedIds.length}
    <span class="tiny muted">Nothing to choose yet — add some first.</span>
  {/if}
</div>
