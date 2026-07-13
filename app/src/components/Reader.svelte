<script>
  import { untrack, tick } from 'svelte';
  import GuideView from './GuideView.svelte';
  import MapView from './MapView.svelte';
  import FilterBar from './FilterBar.svelte';
  import Drawer from './Drawer.svelte';
  import DryRunPanel from './DryRunPanel.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Importance from './Importance.svelte';
  import Icon from './Icon.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import logo from '../assets/logo.svg';
  import ExportDialog from './ExportDialog.svelte';
  import ExportSizeBanner from './ExportSizeBanner.svelte';
  import StalenessBanner from './StalenessBanner.svelte';
  import AudienceGate from './AudienceGate.svelte';
  import GlobalSearch from './GlobalSearch.svelte';
  import ReadinessView from './ReadinessView.svelte';
  import { langValue } from '../lib/package.js';

  let { store, onClose, readOnly = false, initialAudience = null, initialView = null } = $props();

  const pkg = $derived(store.pkg);
  const editing = $derived(!readOnly && store.mode === 'edit');

  // /demo (and similar) can pre-answer the "who are you?" gate — e.g. open the
  // sample directly as the primary heir would see it.
  $effect(() => {
    if (initialAudience && !chosen && audiences.some((p) => p.id === initialAudience)) {
      chooseAudience(initialAudience);
    }
  });

  async function toggleEdit() {
    if (readOnly) return;
    // Stay on the guide being read: 'start' is an alias for "first guide in
    // the CURRENT list", and that list changes between read (published, per
    // audience) and edit (everything, incl. drafts) — without pinning, EDIT
    // could land on whichever draft happens to sort first.
    const stayOn = currentGuide;
    if (editing) {
      store.stopEditing();
      // Owner previewing their own plan — skip the heir "who are you?" gate and
      // show everything; they can still preview a person via "Reading as".
      chosen = true;
    } else {
      store.startEditing();
    }
    if (stayOn) {
      await tick(); // let homeGuide re-derive for the new mode before aliasing
      view = guideTarget(stayOn);
    }
  }
  function isTextEditingTarget(target) {
    const el = target instanceof Element ? target : null;
    return !!el?.closest('input, textarea, select, [contenteditable="true"]');
  }
  function onKeydown(e) {
    if (readOnly || showGate) return;
    // Ctrl+E (or Cmd+E) toggles edit mode.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      toggleEdit();
      return;
    }
    if (isTextEditingTarget(e.target)) return;
  }
  function addPerson() { setDrawer(store.addPerson()); }
  function addRole() { setDrawer(store.addRole()); }
  function addLocation(parentId = null) { setDrawer(store.addLocation(parentId)); }
  function addItem() { setDrawer(store.addItem()); }
  function addReadiness() { view = 'readiness'; setDrawer(store.addReadinessCheck()); }
  function addGuide() {
    const id = store.addGuide();
    closeDrawer();
    const g = pkg.guides.find((x) => x.id === id);
    view = g ? guideTarget(g) : id;
    focusNewGuideTitle = true;
    window.scrollTo({ top: 0 });
  }
  function openSettings() { store.startSettings(); setDrawer('__meta'); }
  async function lockDraft() { await store.lockDraft(); onClose?.(); }
  function openMapSettings() { setDrawer('__map'); }
  function editEntity(id) { setDrawer(id); }
  function rowClick(id) { if (editing) setDrawer(id); else openEntity(id); }

  // Side-panel history so you can drill in and step back (Productboard-style).
  let drawerStack = $state([]);
  function setDrawer(id) { drawerStack = []; drawerId = id; }       // fresh open from a list/add
  function pushDrawer(id) { if (drawerId && drawerId !== id) drawerStack = [...drawerStack, drawerId]; drawerId = id; }
  function closeDrawer() { drawerStack = []; drawerId = null; }
  function drawerBack() { const s = drawerStack; drawerId = s[s.length - 1] ?? null; drawerStack = s.slice(0, -1); }

  let modalPrompt = $state(null);
  let modalResolve = null;
  function askModal(options) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      modalPrompt = {
        eyebrow: 'Confirm',
        title: 'Are you sure?',
        message: '',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        tone: 'info',
        ...options
      };
    });
  }
  function resolveModal(value) {
    const resolve = modalResolve;
    modalPrompt = null;
    modalResolve = null;
    resolve?.(value);
  }
  const requestConfirm = (options) => askModal({
    tone: 'danger',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    ...options
  });
  const requestNotice = (options) => askModal({
    eyebrow: 'Notice',
    title: 'Heads up',
    tone: 'info',
    confirmLabel: 'OK',
    cancelLabel: null,
    ...options
  });

  // ---- multi-select in section lists (toggle, shift-range, select-all) ----
  let selectedIds = $state([]);
  let anchorIndex = $state(null); // last row toggled, for shift-click ranges
  function toggleSelect(id) {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  }
  // ids = the ordered ids currently shown in the list; i = clicked row index.
  function rowSelect(ids, i, e) {
    if (e?.shiftKey && anchorIndex != null && anchorIndex < ids.length) {
      const [a, b] = [Math.min(anchorIndex, i), Math.max(anchorIndex, i)];
      const turnOn = !selectedIds.includes(ids[i]); // extend in the same direction as the click
      const set = new Set(selectedIds);
      for (const id of ids.slice(a, b + 1)) { if (turnOn) set.add(id); else set.delete(id); }
      selectedIds = [...set];
    } else {
      toggleSelect(ids[i]);
    }
    anchorIndex = i;
  }
  const allSelected = (ids) => ids.length > 0 && ids.every((id) => selectedIds.includes(id));
  function toggleSelectAll(ids) {
    selectedIds = allSelected(ids) ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])];
    anchorIndex = null;
  }
  async function deleteSelected(noun) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const ok = await requestConfirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'}?`,
      message: `Deleting ${ids.length} selected ${noun}. This cannot be undone here.`
    });
    if (!ok) return;
    for (const id of ids) { if (drawerId === id) closeDrawer(); store.deleteEntity(id); }
    selectedIds = [];
  }
  async function deleteReadinessRun(id) {
    const ok = await requestConfirm({
      title: 'Delete test run?',
      message: 'This removes the test run and all answers recorded in it. This cannot be undone here.',
      confirmLabel: 'Delete'
    });
    if (ok) store.deleteReadinessRun(id);
  }
  async function deleteReadinessRuns(ids) {
    if (!ids?.length) return;
    const ok = await requestConfirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'test' : 'tests'}?`,
      message: 'This removes the selected tests and all answers recorded in them. This cannot be undone here.',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    for (const id of ids) store.deleteReadinessRun(id);
    selectedIds = selectedIds.filter((id) => !ids.includes(id));
  }
  function openReadinessRun(id) {
    setDrawer(`__run:${id}`);
  }

  async function removeEntity(id) {
    const entity = pkg.entity(id);
    const kind = entity?.kind === 'attachment' ? 'file' : entity?.kind === 'readiness' ? 'readiness check' : (entity?.kind || 'item');
    const name = pkg.name(id);
    const ok = await requestConfirm({
      title: `Delete '${name}' ${kind}?`,
      message: 'This will delete it and any references to it. This cannot be undone here.'
    });
    if (!ok) return;
    if (drawerId === id) drawerId = null;
    store.deleteEntity(id);
  }
  function roleUsage(roleId) {
    const people = (store?.data?.people || []).filter((p) => (p.roles || []).includes(roleId)).length;
    const guides = (store?.data?.guides || []).filter((g) => (g.audience_roles || []).includes(roleId)).length;
    return { people, guides };
  }
  function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }
  let showExport = $state(false);
  let fileInput = $state(null);
  let focusNewGuideTitle = $state(false);

  async function onFile(e) {
    const files = [...(e.target.files || [])];
    let lastId = null;
    for (const f of files) lastId = await store.addAttachmentFile(f);
    if (files.length === 1 && lastId) { setDrawer(lastId); }
    else if (files.length > 1) { await tick(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
    e.target.value = '';
  }

  async function uploadGuideMedia(guideId, file) {
    const kind = isImageFile(file) ? 'img' : isMp4File(file) ? 'video' : null;
    if (!kind) return null;
    const id = await store.addAttachmentFile(file);
    const att = store.data?.attachments?.find((a) => a.id === id);
    if (att) {
      if (!Array.isArray(att.guide_ids)) att.guide_ids = [];
      if (!att.guide_ids.includes(guideId)) att.guide_ids.push(guideId);
    }
    store.addGuideRef(guideId, 'attachment_ids', id);
    return { id, kind };
  }

  let audience = $state(null);
  let chosen = $state(false);
  let view = $state(initialView || 'start');
  let drawerId = $state(null);
  let dryRun = $state(false);
  let dryRunId = $state(null);
  let query = $state('');
  let filters = $state({});  // faceted filters per list: { facetKey: [values] }
  let sortBy = $state('name');
  // Items lead with importance; the other lists open alphabetically.
  const defaultSort = (v) => (v === 'items' ? 'importance' : 'name');
  let bulkTag = $state(''); // pending tag to apply to selected files
  function applyBulkTag() {
    const t = bulkTag.trim();
    if (!t || !selectedIds.length) return;
    store.addTagToAttachments(selectedIds, t);
    bulkTag = '';
  }
  // Jump to the Files view filtered to one tag (used by guide tag-links).
  function openTag(tag) { view = 'files'; query = ''; selectedIds = []; filters = { tag: [tag] }; sortBy = defaultSort('files'); closeDrawer(); window.scrollTo({ top: 0 }); }

  // ---- faceted filtering + sort ----
  const IMP_RANK = { high: 0, medium: 1, low: 2 };
  function passesFacets(obj, defs) {
    for (const f of defs) {
      const sel = filters[f.key];
      if (sel?.length && !sel.some((v) => f.test(obj, v))) return false;
    }
    return true;
  }
  const entityName = (o) => (o?.name || o?.title || o?.filename || '').toString();
  function sortList(arr, by) {
    if (by === 'name') return [...arr].sort((a, b) => entityName(a).localeCompare(entityName(b)));
    if (by === 'name_desc') return [...arr].sort((a, b) => entityName(b).localeCompare(entityName(a)));
    // 'importance' is a stable re-sort of the already importance-then-name list.
    if (by === 'importance') return [...arr].sort((a, b) => (IMP_RANK[a.importance] ?? 9) - (IMP_RANK[b.importance] ?? 9));
    return arr;
  }
  const IMAGE_FILE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?)$/i;
  const isImageFile = (file) => !!file && (file.type?.startsWith('image/') || IMAGE_FILE_EXT.test(file.name || ''));
  const isMp4File = (file) => !!file && ((file.type || '').toLowerCase() === 'video/mp4' || /\.mp4$/i.test(file.name || ''));
  const fileType = (a) => (a.mime || '').startsWith('image/') ? 'image' : ((a.mime || '') === 'video/mp4' || /\.mp4$/i.test(a.path || a.filename || '')) ? 'video' : ((a.mime || '') === 'application/pdf' || /\.pdf$/i.test(a.path || a.filename || '')) ? 'pdf' : 'other';
  const impFacet = (list) => ({ key: 'importance', label: 'Importance', test: (o, v) => o.importance === v, options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([value, label]) => ({ value, label, count: list.filter((o) => o.importance === value).length })).filter((o) => o.count) });
  // Lists that carry importance lead with it; the rest sort by name only.
  const SORTS_IMP = [{ value: 'importance', label: 'Importance' }, { value: 'name', label: 'Name (A→Z)' }, { value: 'name_desc', label: 'Name (Z→A)' }];
  const SORTS_NAME = [{ value: 'name', label: 'Name (A→Z)' }, { value: 'name_desc', label: 'Name (Z→A)' }];
  const peopleFacets = $derived([
    { key: 'role', label: 'Role', test: (p, v) => (p.roles || []).includes(v), options: pkg.roles.map((r) => ({ value: r.id, label: pkg.roleLabel(r.id), count: pkg.people.filter((p) => (p.roles || []).includes(r.id)).length })).filter((o) => o.count) }
  ]);
  const itemFacets = $derived([
    impFacet(pkg.items),
    { key: 'location', label: 'Location', test: (it, v) => (it.location_ids || []).includes(v), options: pkg.locations.map((l) => ({ value: l.id, label: pkg.name(l.id), count: pkg.items.filter((it) => (it.location_ids || []).includes(l.id)).length })).filter((o) => o.count) },
    { key: 'access', label: 'Who can access', test: (it, v) => v === '__none' ? !(it.access_person_ids || []).length : (it.access_person_ids || []).includes(v), options: [{ value: '__none', label: 'None', count: pkg.items.filter((it) => !(it.access_person_ids || []).length).length }, ...pkg.people.map((p) => ({ value: p.id, label: pkg.name(p.id), count: pkg.items.filter((it) => (it.access_person_ids || []).includes(p.id)).length }))].filter((o) => o.count) },
    { key: 'price', label: 'Price', test: (it, v) => (v === 'has') === !!String(it.price || '').trim(), options: [{ value: 'has', label: 'Has price', count: pkg.items.filter((it) => String(it.price || '').trim()).length }].filter((o) => o.count) }
  ]);
  const locHasItems = (loc) => (pkg.itemsAtLocation.get(loc.id) || []).length > 0;
  const locationFacets = $derived([
    impFacet(pkg.locations),
    { key: 'contents', label: 'Contents', test: (loc, v) => (v === 'has') === locHasItems(loc), options: [['has', 'Holds items'], ['empty', 'Empty']].map(([value, label]) => ({ value, label, count: pkg.locations.filter((l) => (value === 'has') === locHasItems(l)).length })).filter((o) => o.count) }
  ]);
  const fileFacets = $derived([
    { key: 'tag', label: 'Tag', test: (a, v) => (a.tags || []).includes(v), options: pkg.allTags().map((t) => ({ value: t, label: '# ' + t, count: pkg.attachmentsWithTag(t).length })) },
    { key: 'type', label: 'Type', test: (a, v) => fileType(a) === v, options: [['image', 'Images'], ['video', 'Videos'], ['pdf', 'PDFs'], ['other', 'Other']].map(([value, label]) => ({ value, label, count: (pkg.attachments || []).filter((a) => fileType(a) === value).length })).filter((o) => o.count) },
    { key: 'item_link', label: 'Attached to items', test: (a, v) => (v === 'has') === !![...(a.item_ids || []), a.item_id].filter(Boolean).length, options: [['has', 'Assigned'], ['none', 'None']].map(([value, label]) => ({ value, label, count: (pkg.attachments || []).filter((a) => (value === 'has') === !![...(a.item_ids || []), a.item_id].filter(Boolean).length).length })).filter((o) => o.count) },
    { key: 'guide_link', label: 'Attached to guides', test: (a, v) => (v === 'has') === !![...(a.guide_ids || []), a.guide_id].filter(Boolean).length, options: [['has', 'Assigned'], ['none', 'None']].map(([value, label]) => ({ value, label, count: (pkg.attachments || []).filter((a) => (value === 'has') === !![...(a.guide_ids || []), a.guide_id].filter(Boolean).length).length })).filter((o) => o.count) }
  ]);
  let lang = $state(untrack(() => pkg.lang)); // seed once; user can change after

  const matches = (fields) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return fields.some((f) => (f || '').toLowerCase().includes(q));
  };

  const audiences = $derived(pkg.audiences());
  // Primary recipients lead the "who are you?" gate, above a divider.
  const primaryIds = $derived(pkg.primaryRecipientIds());
  const gatePrimary = $derived(primaryIds.map((id) => pkg.entity(id)?.obj).filter(Boolean));
  const gateRest = $derived(audiences.filter((p) => !primaryIds.includes(p.id)));
  // The "who are you?" gate is a reader (heir) step — not shown while editing.
  const showGate = $derived(!chosen && audiences.length && !editing);
  const guides = $derived(editing ? pkg.guides : pkg.guidesFor(audience));
  const navGuides = $derived(guides);
  const groupDefs = $derived(pkg.guideGroups());
  const hasMapContent = $derived((pkg.locations?.length || 0) > 0 || (pkg.items?.length || 0) > 0);

  function mapVisibleFor(personId = audience) {
    if (!hasMapContent) return false;
    if (editing) return true;
    const roles = pkg.meta?.map_audience_roles || [];
    const people = pkg.meta?.map_audience_person_ids || [];
    if (!roles.length && !people.length) return true;
    if (!personId) return true;
    const person = pkg.entity(personId)?.obj;
    return people.includes(personId) || (person?.roles || []).some((r) => roles.includes(r));
  }
  const canSeeMap = $derived(mapVisibleFor(audience));
  const noGuidesForAudience = $derived(!editing && !!audience && guides.length === 0);
  // The physical steps to reach the plan — the heir's very first screen.
  function pathFor(personId) {
    return (personId && pkg.entity(personId)?.obj?.access_path?.steps) || [];
  }
  function defaultViewFor(personId) {
    if (pathFor(personId).length) return 'access';
    return pkg.guidesFor(personId).length ? 'start' : (mapVisibleFor(personId) ? 'map' : 'start');
  }

  const navBlocks = $derived.by(() => {
    const groups = new Map(groupDefs.map((d) => [d.id, { kind: 'group', id: d.id, title: langValue(d.name, d.raw?.name_i18n, lang), raw: d.raw, guides: [], order: d.order ?? Infinity, explicit: d.order != null }]));
    const blocks = [];
    for (const g of navGuides) {
      if (g.group) {
        let block = groups.get(g.group);
        if (!block) {
          block = { kind: 'group', id: g.group, title: guideGroupLabel(g.group), raw: null, guides: [], order: Infinity, explicit: false };
          groups.set(g.group, block);
        }
        block.guides.push(g);
        // An explicit group order wins; earliest-member order is only the
        // fallback. Authored plans often number guides per group (0,1,2…),
        // which would otherwise collapse every group to 0 and leave the nav
        // sorted by group id.
        if (!block.explicit) block.order = Math.min(block.order, g.order ?? Infinity);
      } else {
        blocks.push({ kind: 'guide', id: g.id, guide: g, order: g.order ?? Infinity });
      }
    }
    for (const block of groups.values()) {
      block.guides.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
      if (editing || block.guides.length) blocks.push(block);
    }
    return blocks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  });
  const flatNav = $derived(navBlocks.flatMap((entry) => entry.kind === 'group' ? entry.guides : [entry.guide]));
  const nextId = $derived.by(() => {
    const m = new Map();
    for (let i = 0; i < flatNav.length; i++) m.set(flatNav[i].id, flatNav[i + 1]?.id ?? null);
    return m;
  });
  const navGroups = $derived(navBlocks);
  const nextEntryKey = $derived.by(() => {
    const m = new Map();
    for (let i = 0; i < navGroups.length; i++) m.set(`${navGroups[i].kind}:${navGroups[i].id}`, navGroups[i + 1] ? `${navGroups[i + 1].kind}:${navGroups[i + 1].id}` : null);
    return m;
  });

  // ---- drag & drop reordering (edit mode) ----
  let drag = $state(null); // { kind: 'guide' | 'group', id }
  let dropAnchor = $state(null); // { id, pos: 'before'|'after' }
  let dropGroup = $state(null);  // group id highlighted as a drop target
  let dropEnd = $state(false);

  function dragStart(e, id) {
    if (!editing) return;
    drag = { kind: 'guide', id };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
  function groupDragStart(e, id) {
    if (!editing) return;
    drag = { kind: 'group', id };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
  function dragClear() { drag = null; dropAnchor = null; dropGroup = null; dropEnd = false; }
  function entryOver(e, entryKey) {
    if (!drag || drag.kind !== 'group') return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    dropGroup = null; dropEnd = false;
    dropAnchor = { entryKey, pos: after ? 'after' : 'before', beforeKey: after ? nextEntryKey.get(entryKey) : entryKey };
  }
  function entryDrop(e) {
    if (!drag || drag.kind !== 'group' || !dropAnchor) return;
    e.preventDefault(); e.stopPropagation();
    if (dropAnchor.entryKey !== `group:${drag.id}`) store.moveGuideGroup(drag.id, dropAnchor.beforeKey);
    dragClear();
  }
  function guideOver(e, g) {
    if (!drag) return;
    if (drag.kind === 'group') { entryOver(e, `guide:${g.id}`); return; }
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    dropGroup = null; dropEnd = false;
    dropAnchor = { id: g.id, pos: after ? 'after' : 'before', group: g.group ?? null, beforeId: after ? nextId.get(g.id) : g.id };
  }
  function guideDrop(e) {
    if (drag?.kind === 'group') { entryDrop(e); return; }
    if (!drag || !dropAnchor) return;
    e.preventDefault(); e.stopPropagation();
    if (drag.id !== dropAnchor.id) store.moveGuide(drag.id, dropAnchor.group, dropAnchor.beforeId);
    dragClear();
  }
  function groupOver(e, grp) {
    if (!drag) return;
    if (drag.kind === 'group') { entryOver(e, `group:${grp.id}`); return; }
    e.preventDefault(); e.stopPropagation();
    dropAnchor = null; dropEnd = false; dropGroup = grp.id;
  }
  function groupDrop(e, grp) {
    if (drag?.kind === 'group') { entryDrop(e); return; }
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    store.moveGuide(drag.id, grp.id, grp.guides[0]?.id ?? null);
    dragClear();
  }
  function beforeGroupOver(e, grp) {
    if (!drag || drag.kind !== 'guide') return;
    e.preventDefault(); e.stopPropagation();
    dropGroup = null; dropEnd = false;
    dropAnchor = { entryKey: `group:${grp.id}`, pos: 'before', group: null, beforeId: grp.guides[0]?.id ?? null };
  }
  function beforeGroupDrop(e, grp) {
    if (!drag || drag.kind !== 'guide') return;
    e.preventDefault(); e.stopPropagation();
    // Anchor on the group itself (not its first guide) so this works even when
    // the dragged guide IS that first guide, or the group is empty.
    store.moveGuide(drag.id, null, grp.id);
    dragClear();
  }
  function endOver(e) {
    if (!drag) return;
    e.preventDefault();
    dropAnchor = null; dropGroup = null; dropEnd = true;
  }
  function endDrop(e) {
    if (!drag) return;
    e.preventDefault();
    if (drag.kind === 'group') store.moveGuideGroup(drag.id, null);
    else store.moveGuide(drag.id, null, null);
    dragClear();
  }
  let focusGroupId = $state(null);
  function addGuideGroup() { focusGroupId = store.addGuideGroup(); }
  function autofocusGroup(node, gid) {
    const tryFocus = (g) => { if (g === focusGroupId) { node.focus(); node.select?.(); focusGroupId = null; } };
    tryFocus(gid);
    return { update: tryFocus };
  }
  async function removeGroup(gid) {
    const def = groupDefs.find((g) => g.id === gid);
    const ok = await requestConfirm({
      title: `Delete group '${def?.name || gid}'?`,
      message: 'Its guides move to the top level (kept, not deleted). This cannot be undone here.'
    });
    if (!ok) return;
    store.deleteGuideGroup(gid);
  }
  // ---- location drag & drop (nest / reorder) ----
  let locDrag = $state(null);
  let locDrop = $state(null); // { id, pos: 'before'|'inside'|'after'|'end' }
  function locDragStart(e, id) {
    if (!editing) return;
    locDrag = id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
  function locDragEnd() { locDrag = null; locDrop = null; }
  function locOver(e, loc) {
    if (!locDrag || locDrag === loc.id) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const pos = y < r.height * 0.3 ? 'before' : y > r.height * 0.7 ? 'after' : 'inside';
    locDrop = { id: loc.id, pos };
  }
  function nextLocSibling(t) {
    const sibs = t.parent_id ? pkg.locationChildren(t.parent_id) : pkg.locationRoots();
    const i = sibs.findIndex((s) => s.id === t.id);
    return sibs[i + 1] ?? null;
  }
  function locDropOn(e, loc) {
    if (!locDrag || !locDrop) return;
    e.preventDefault(); e.stopPropagation();
    const t = pkg.entity(locDrop.id)?.obj;
    if (t && locDrag !== t.id) {
      if (locDrop.pos === 'inside') store.moveLocation(locDrag, t.id, null);
      else {
        const parent = t.parent_id || null;
        const beforeId = locDrop.pos === 'before' ? t.id : (nextLocSibling(t)?.id ?? null);
        store.moveLocation(locDrag, parent, beforeId);
      }
    }
    locDragEnd();
  }
  function locEndOver(e) { if (!locDrag) return; e.preventDefault(); locDrop = { id: '__end', pos: 'end' }; }
  function locEndDrop(e) { if (!locDrag) return; e.preventDefault(); store.moveLocation(locDrag, null, null); locDragEnd(); }

  // The "start" view. Editing: land on the first guide as the NAV shows it —
  // importance must not hijack the owner's landing view. Reading (heir):
  // keep the importance-first pick, so e.g. a personal message marked high
  // greets its reader before the how-to guides (persona-review decision).
  const homeGuide = $derived(editing ? (flatNav[0] || null) : (guides[0] || null));
  const owner = $derived(pkg.owner);
  const readinessChecks = $derived(pkg.readinessOrdered());
  const readinessCount = $derived(readinessChecks.length);
  const readinessRuns = $derived([...(store.data?.readiness_runs || [])].sort((a, b) => {
    const at = Date.parse(a.submitted_at || a.started_at || a.date || '');
    const bt = Date.parse(b.submitted_at || b.started_at || b.date || '');
    if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
    return String(b.date || '').localeCompare(String(a.date || ''));
  }));
  const canSeeReadiness = $derived(!readOnly && !dryRun && (editing || audience === null));
  const canShowReadinessData = $derived(!readOnly && !dryRun && (editing || audience === null));

  const attachments = $derived(pkg.attachmentsOrdered());
  const currentGuide = $derived(view === 'start' ? homeGuide : pkg.guides.find((g) => g.id === view) || null);
  // Language only matters where there are translations — i.e. when viewing a guide.
  const inGuideView = $derived(!!currentGuide);
  const locTree = $derived(pkg.locationTreeFlat());
  const locationRows = $derived.by(() => {
    const facetOn = locationFacets.some((f) => (filters[f.key] || []).length);
    if (!query.trim() && !facetOn) return locTree;
    const keep = new Set();
    for (const loc of pkg.locations || []) {
      if (matches([loc.name, loc.notes, ...(pkg.locationPath(loc.id) || []).map((p) => p.name)]) && passesFacets(loc, locationFacets)) {
        keep.add(loc.id);
        for (const parent of pkg.locationPath(loc.id)) keep.add(parent.id);
      }
    }
    return locTree.filter(({ loc }) => keep.has(loc.id));
  });
  // Reordering only makes sense on the full, unfiltered tree.
  const locReorderable = $derived(!query.trim() && !locationFacets.some((f) => (filters[f.key] || []).length));
  const peopleResults = $derived(sortList(pkg.peopleOrdered().filter((p) => matches(personSearchFields(p)) && passesFacets(p, peopleFacets)), sortBy));
  const roleResults = $derived(sortList(pkg.roles.filter((role) => matches([role.id, role.name])), sortBy));
  const itemResults = $derived(sortList(pkg.itemsOrdered().filter((it) => matches([it.name, it.description, it.price, it.notes]) && passesFacets(it, itemFacets)), sortBy));
  const fileResults = $derived(sortList(attachments.filter((att) => matches([att.filename, att.description, att.path, ...(att.tags || [])]) && passesFacets(att, fileFacets)), sortBy));
  // Ordered ids per list, for select-all and shift-range selection.
  const peopleIds = $derived(peopleResults.map((p) => p.id));
  const roleIds = $derived(roleResults.map((r) => r.id));
  const locIds = $derived(locationRows.map((r) => r.loc.id));
  const itemIds = $derived(itemResults.map((it) => it.id));
  const fileIds = $derived(fileResults.map((a) => a.id));
  const planOwnerName = $derived(owner?.name || 'the owner');
  const adminLabel = $derived(`Admin${owner?.nickname ? ` (${owner.nickname})` : ''}`);
  // The plan's own title (set in Settings) leads; fall back to the owner's name.
  const planTitle = $derived(pkg.meta.title?.trim() || `Inheritance plan of ${planOwnerName}`);
  function openEntity(id) {
    const e = pkg.entity(id);
    if (e && e.kind === 'guide') {
      view = guideTarget(e.obj);
      closeDrawer();
      window.scrollTo({ top: 0 });
    } else {
      pushDrawer(id);
    }
  }
  function go(v) {
    if (v === 'map' && !canSeeMap) return;
    if (v === 'readiness' && !canSeeReadiness) return;
    view = v;
    closeDrawer();
    query = '';
    selectedIds = [];
    anchorIndex = null;
    filters = {};
    sortBy = defaultSort(v);
    bulkTag = '';
    window.scrollTo({ top: 0 });
  }
  function chooseAudience(id) { audience = id; chosen = true; view = defaultViewFor(id); }
  function switchAudience(v) {
    audience = v === '__all' ? null : v;
    view = defaultViewFor(audience);
    drawerId = null;
    window.scrollTo({ top: 0 });
  }
  function startDryRun(personId = null) {
    if (readOnly) return;
    const id = personId || audience || primaryIds[0] || audiences[0]?.id || null;
    store.startSettings();
    store.stopEditing();
    chosen = true;
    audience = id;
    view = defaultViewFor(id);
    dryRunId = store.startReadinessRun(id);
    dryRun = true;
    closeDrawer();
    window.scrollTo({ top: 0 });
  }
  function applicableReadinessChecks(personId = audience) {
    return readinessChecks.filter((check) => {
      if ((check.scope || 'external') !== 'external') return false;
      if (!personId) return true;
      const person = pkg.entity(personId)?.obj;
      if ((check.person_ids || []).includes(personId)) return true;
      if ((check.role_ids || []).some((role) => (person?.roles || []).includes(role))) return true;
      return !(check.person_ids || []).length && !(check.role_ids || []).length;
    });
  }
  // A dry run only makes sense when the person it would target actually has
  // questions/tasks to walk through — same person pick as startDryRun.
  const dryRunTaskCount = $derived.by(() => {
    const target = audience || primaryIds[0] || audiences[0]?.id || null;
    return applicableReadinessChecks(target).length;
  });
  function cancelDryRun() {
    if (dryRunId) store.deleteReadinessRun(dryRunId);
    dryRun = false;
    dryRunId = null;
  }
  async function submitDryRun() {
    if (dryRunId) {
      store.submitReadinessRun(dryRunId);
      const run = store.data?.readiness_runs?.find((r) => r.id === dryRunId);
      const results = run?.results || [];
      const answered = results.filter((r) => ['pass', 'not_sure', 'fail', 'blocked'].includes(r.status)).length;
      const checks = applicableReadinessChecks(audience);
      const name = audience ? pkg.name(audience) : adminLabel;
      await askModal({
        eyebrow: 'Dry run',
        title: `Thank you ${name}.`,
        message: `${answered}/${checks.length} answered.`,
        confirmLabel: 'Close',
        cancelLabel: null,
        tone: 'info'
      });
    }
    dryRun = false;
    dryRunId = null;
  }

  // ---- Global search — the topbar box + dropdown live in GlobalSearch; the
  // parent keeps the query (so the full "search" view can read it) and decides
  // what a pick / "see all" does. ----
  let gquery = $state('');
  const KIND_LABEL = { guide: 'Guide', person: 'Person', item: 'Item', location: 'Location', attachment: 'File', role: 'Role', readiness: 'Readiness' };
  const visibleSearch = (results) => canShowReadinessData ? results : results.filter((r) => r.kind !== 'readiness');
  const searchResults = $derived(view === 'search' ? visibleSearch(pkg.search(gquery, 50)) : []);
  function pickResult(id) { openEntity(id); }                                    // guide → navigate; entity → drawer
  function goSearch() { if (gquery.trim()) { view = 'search'; closeDrawer(); window.scrollTo({ top: 0 }); } }

  $effect(() => {
    if (!pkg.languages.includes(lang)) lang = pkg.lang;
    pkg.lang = lang;
  });

  $effect(() => {
    if (showGate || editing) return;
    if (view === 'map' && !canSeeMap) view = 'start';
    if (view === 'access' && (editing || !pathFor(audience).length)) view = 'start';
    if (view === 'start' && !homeGuide && canSeeMap) view = 'map';
  });
  $effect(() => {
    if (view === 'readiness' && !canSeeReadiness) view = defaultViewFor(audience);
    if (!canShowReadinessData && drawerId && pkg.entity(drawerId)?.kind === 'readiness') closeDrawer();
  });

  // Apply appearance. The plan's saved theme is the default; the top-bar toggle
  // is a live, non-persisted override (works even in the read-only heir build).
  let themeOverride = $state(null);
  let appliedDark = $state(false);
  $effect(() => {
    const theme = themeOverride ?? pkg?.meta?.theme;
    const root = document.documentElement;
    const apply = (dark) => { appliedDark = dark; root.setAttribute('data-theme', dark ? 'dark' : 'light'); };
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const upd = () => apply(mq.matches);
      upd();
      mq.addEventListener('change', upd);
      return () => { mq.removeEventListener('change', upd); root.removeAttribute('data-theme'); };
    }
    apply(theme === 'dark');
    return () => root.removeAttribute('data-theme');
  });
  function toggleTheme() { themeOverride = appliedDark ? 'light' : 'dark'; }

  // Reading font for guide text — the owner's choice (Settings) travels with the
  // plan, so the heir reader renders the guides in the same face. Default: mono.
  const READING_FONTS = {
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    sans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    inter: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    atkinson: '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
    literata: '"Literata", Georgia, "Times New Roman", serif',
    lora: '"Lora", Georgia, "Times New Roman", serif'
  };
  const readingFont = $derived(READING_FONTS[pkg.meta?.reading_font] || READING_FONTS.mono);

  function guideTarget(guide) {
    return guide?.id === homeGuide?.id ? 'start' : guide.id;
  }

  function guideGroupLabel(group) {
    return group
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function personDesc(p) {
    return p.notes || '';
  }

  function personSearchFields(p) {
    return [
      pkg.name(p.id),
      p.name,
      p.nickname,
      p.display_as,
      p.notes,
      ...(p.roles || []),
      ...(p.roles || []).map((r) => pkg.roleLabel(r))
    ];
  }

  function emptySearchLabel(noun) {
    const q = query.trim();
    return q ? `No results for "${q}".` : `No ${noun} yet.`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell" class:with-actions={!readOnly} style="--reading-font: {readingFont};">
  {#if editing}
    <StalenessBanner {store} onReview={() => go('readiness')} />
    <ExportSizeBanner {store} />
  {/if}
  <header class="topbar no-print">
    <div class="bar">
      <div class="bar-plan">
        {#if readOnly}
          <div class="brand row"><img class="logo" src={logo} alt="" aria-hidden="true" /><span class="plan-title" title={planTitle}>{planTitle}</span></div>
        {:else}
          <button class="brand-home" onclick={onClose} title="Back to start" aria-label="Back to start"><img class="logo" src={logo} alt="" aria-hidden="true" /></button>
          {#if editing && store.data?.package}
            <input class="plan-title-input" bind:value={store.data.package.title} placeholder="My plan" aria-label="Plan title" />
          {:else}
            <span class="plan-title" title={planTitle}>{planTitle}</span>
          {/if}
        {/if}
      </div>
      {#if !showGate}
        <GlobalSearch {pkg} bind:query={gquery} filter={visibleSearch} onPick={pickResult} onSeeAll={goSearch} />
      {/if}
      <div class="bar-actions">
        {#if editing && !showGate}<span class="sr-only" aria-live="polite">{store.savedAt ? 'Auto-saved to this device' : 'Saving…'}</span>{/if}
        {#if chosen && !editing}
          <div class="reader-tools" title="Read this plan as a particular person">
            <label class="sel-wrap">
              <span class="tiny muted">Reading as</span>
              <select class="sel" value={audience ?? '__all'} onchange={(e) => switchAudience(e.target.value)}>
                <option value="__all">{adminLabel}</option>
                {#each audiences as p}<option value={p.id}>{pkg.name(p.id)}</option>{/each}
              </select>
            </label>
            {#if !readOnly}
            <button class="iconbtn" class:on={dryRun} disabled={!dryRun && !dryRunTaskCount} data-tip={dryRun ? 'Dry run in progress' : (dryRunTaskCount ? 'Start dry run' : 'No questions or tasks for this person yet')} aria-label={dryRun ? 'Dry run in progress' : 'Start dry run'} onclick={() => dryRun ? null : startDryRun()}>
                {#if dryRun}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {/if}
              </button>
            {/if}
          </div>
        {/if}
        {#if readOnly}
          <button class="iconbtn" title={appliedDark ? 'Light mode' : 'Dark mode'} aria-label="Toggle dark mode" onclick={toggleTheme}>
            {#if appliedDark}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
              </svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            {/if}
          </button>
        {/if}
        {#if !showGate}
          {#if !readOnly && store.draftProtected}
            <button class="iconbtn" data-tip="Lock the draft and return to start" aria-label="Lock draft" onclick={lockDraft}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
          {/if}
          {#if pkg.languages.length > 1}
            <select class="sel lang" bind:value={lang} aria-label="Language" title="Language">
              {#each pkg.languages as l}<option value={l}>{l.toUpperCase()}</option>{/each}
            </select>
          {/if}
          {#if readOnly}
            <!-- The heir's file has no action rail — print stays up here. -->
            <button class="iconbtn" data-tip="Print" aria-label="Print" onclick={() => window.print()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </header>

  {#if showGate}
    <AudienceGate {pkg} {owner} primary={gatePrimary} rest={gateRest} {adminLabel}
      onChoose={chooseAudience} onAdmin={() => { audience = null; chosen = true; }} />
  {:else}
    <div class="body">
      {#if !readOnly}
        <!-- Action rail: the app's verbs, Productboard-style — icons with
             tiny labels, Settings pinned to the bottom. -->
        <aside class="actionbar no-print">
          <div class="actionbar-in">
            <button class="abtn" class:on={editing} class:plan-done={editing} class:plan-edit={!editing} onclick={toggleEdit} aria-label={editing ? 'Done editing' : 'Edit'}>
              {#if editing}
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
                <span>Read</span>
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                <span>Edit</span>
              {/if}
            </button>
            <button class="abtn" onclick={() => (showExport = true)} aria-label="Export">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              <span>Export</span>
            </button>
            <!-- Printing an edit surface produces a broken page — print reads the view. -->
            <button class="abtn" disabled={editing} data-tip={editing ? 'Switch to view mode to print' : undefined} data-tip-pos="right" onclick={() => window.print()} aria-label="Print">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
              <span>Print</span>
            </button>
            <span class="aspacer"></span>
            <button class="abtn" onclick={openSettings} aria-label="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.08.1a2 2 0 0 1-3.84 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.1-.08a2 2 0 0 1 0-3.84L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.08-.1a2 2 0 0 1 3.84 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.08.36.28.7.6 1l.1.08a2 2 0 0 1 0 3.84L20 14c-.32.3-.52.64-.6 1Z" /></svg>
              <span>Settings</span>
            </button>
          </div>
        </aside>
      {/if}
      <!-- Navigation rail: a full-height pane that shares its right border
           with the content pane — frames touch, Productboard-style. -->
      <div class="railcol no-print">
      <nav class="nav" class:editing>
        {#snippet draftMark()}
          <span class="draft-mark" title="Draft — left out of the heir reader (.html)" aria-label="Draft">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </span>
        {/snippet}
        {#if !editing && audience && pathFor(audience).length}
          <button class="navlink navlink-access" class:active={view === 'access'} onclick={() => go('access')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Your access path
          </button>
        {/if}
        {#each navGroups as entry (entry.kind + ':' + entry.id)}
          {#if entry.kind === 'group'}
            {#if editing}
              <!-- Always present (not inserted on drag-start): inserting a node
                   *before* the dragged guide would reparent it and cancel the
                   native drag. We only toggle its size/active state via class. -->
              <div
                class="before-group-zone"
                class:armed={drag?.kind === 'guide'}
                class:active={dropAnchor?.entryKey === `group:${entry.id}` && dropAnchor.pos === 'before'}
                ondragover={(e) => beforeGroupOver(e, entry)}
                ondrop={(e) => beforeGroupDrop(e, entry)}
                role="presentation"
              ></div>
            {/if}
            <div
              class="navgroup"
              class:drop-on={dropGroup === entry.id}
              class:dragging={drag?.kind === 'group' && drag.id === entry.id}
              class:drop-before={dropAnchor?.entryKey === `group:${entry.id}` && dropAnchor.pos === 'before'}
              class:drop-after={dropAnchor?.entryKey === `group:${entry.id}` && dropAnchor.pos === 'after'}
              ondragover={(e) => groupOver(e, entry)}
              ondrop={(e) => groupDrop(e, entry)}
              role="presentation"
            >
              <div class="navgroup-title">
                {#if editing}
                  <span
                    class="grip group-grip"
                    aria-hidden="true"
                    draggable="true"
                    ondragstart={(e) => groupDragStart(e, entry.id)}
                    ondragend={dragClear}
                  >⠿</span>
                  {#if entry.raw}
                    <input class="navgroup-input" value={langValue(entry.raw.name, entry.raw.name_i18n, lang)} oninput={(e) => store.setGroupName(entry.id, lang, e.target.value)} aria-label="Group name" use:autofocusGroup={entry.id} />
                  {:else}
                    <span>{entry.title}</span>
                  {/if}
                  <button class="navgroup-del" title="Delete group" aria-label="Delete group" onclick={() => removeGroup(entry.id)}><TrashIcon /></button>
                {:else}
                  <span class="navgroup-read-title">{entry.title}</span>
                {/if}
              </div>
              <div class="navgroup-items">
                {#each entry.guides as g (g.id)}
                  {@const target = guideTarget(g)}
                  <div
                    class="navrow"
                    class:is-draft={g.draft}
                    class:dragging={drag?.kind === 'guide' && drag.id === g.id}
                    class:drop-before={(dropAnchor?.id === g.id || dropAnchor?.entryKey === `guide:${g.id}`) && dropAnchor.pos === 'before'}
                    class:drop-after={(dropAnchor?.id === g.id || dropAnchor?.entryKey === `guide:${g.id}`) && dropAnchor.pos === 'after'}
                    ondragover={(e) => guideOver(e, g)}
                    ondrop={guideDrop}
                    role="presentation"
                  >
                    {#if editing}
                      <span class="grip navguide-grip" title="Drag to reorder" role="button" tabindex="0" aria-label="Drag to reorder guide" draggable="true" ondragstart={(e) => dragStart(e, g.id)} ondragend={dragClear}>⠿</span>
                      {#if g.draft}{@render draftMark()}{/if}
                      <input class="navguide-input navguide-child" class:active={view === target} value={langValue(g.title, g.title_i18n, lang)} oninput={(e) => store.setGuideTitle(g.id, lang, e.target.value)} onclick={() => go(target)} placeholder="Guide name" aria-label="Guide name" />
                      <button class="rowdel navdel" title="Delete" aria-label="Delete guide" onclick={() => removeEntity(g.id)}><TrashIcon /></button>
                    {:else}
                      {#if g.draft}{@render draftMark()}{/if}
                      <button
                        class="navlink navlink-child"
                        class:active={view === target}
                        onclick={() => go(target)}
                      >{langValue(g.title, g.title_i18n, lang)}</button>
                    {/if}
                  </div>
                {/each}
                {#if editing && !entry.guides.length}<div class="navgroup-empty tiny muted">Drag guides here</div>{/if}
              </div>
            </div>
          {:else}
            {@const target = guideTarget(entry.guide)}
            <div
              class="navrow"
              class:is-draft={entry.guide.draft}
              class:dragging={drag?.kind === 'guide' && drag.id === entry.guide.id}
              class:drop-before={(dropAnchor?.id === entry.guide.id || dropAnchor?.entryKey === `guide:${entry.guide.id}`) && dropAnchor.pos === 'before'}
              class:drop-after={(dropAnchor?.id === entry.guide.id || dropAnchor?.entryKey === `guide:${entry.guide.id}`) && dropAnchor.pos === 'after'}
              ondragover={(e) => guideOver(e, entry.guide)}
              ondrop={guideDrop}
              role="presentation"
            >
              {#if editing}
                <span class="grip navguide-grip" title="Drag to reorder" role="button" tabindex="0" aria-label="Drag to reorder guide" draggable="true" ondragstart={(e) => dragStart(e, entry.guide.id)} ondragend={dragClear}>⠿</span>
                {#if entry.guide.draft}{@render draftMark()}{/if}
                <input class="navguide-input" class:active={view === target} value={langValue(entry.guide.title, entry.guide.title_i18n, lang)} oninput={(e) => store.setGuideTitle(entry.guide.id, lang, e.target.value)} onclick={() => go(target)} placeholder="Guide name" aria-label="Guide name" />
                <button class="rowdel navdel" title="Delete" aria-label="Delete guide" onclick={() => removeEntity(entry.guide.id)}><TrashIcon /></button>
              {:else}
                {#if entry.guide.draft}{@render draftMark()}{/if}
                <button class="navlink" class:active={view === target} onclick={() => go(target)}>{langValue(entry.guide.title, entry.guide.title_i18n, lang)}</button>
              {/if}
            </div>
          {/if}
        {/each}
        {#if noGuidesForAudience}
          <div class="nav-empty-guides">No guides for you yet.</div>
        {/if}
        {#if editing}
          <!-- End drop target: lets a guide (or group) land after the last
               block — e.g. after a trailing group. Always present so arming it
               can't reparent/cancel the active drag. -->
          <div class="end-zone" class:armed={!!drag} class:active={dropEnd} ondragover={endOver} ondrop={endDrop} role="presentation"></div>
        {/if}
        <!-- The Map (spatial overview) sits on its own, set apart from the
             guides above and the object lists below — Productboard-style. -->
        {#if canSeeMap}
          <div class="navsep"></div>
          <button class="navlink navlink-section navlink-map" class:active={view === 'map'} onclick={() => go('map')}>
            <span class="navico" aria-hidden="true"><Icon kind="map" /></span><span class="navlabel">Map</span>
          </button>
        {/if}
        <div class="navsep"></div>
        <div class="navobjects">
          {#if canSeeReadiness}
            <button class="navlink navlink-section" class:active={view === 'readiness'} onclick={() => go('readiness')}>
              <span class="navico" aria-hidden="true"><Icon kind="readiness" /></span><span class="navlabel">Readiness</span><span class="navcount">{readinessCount}</span>
            </button>
          {/if}
          <button class="navlink navlink-section" class:active={view === 'people'} onclick={() => go('people')}>
            <span class="navico" aria-hidden="true"><Icon kind="people" /></span><span class="navlabel">People</span><span class="navcount">{pkg.people.length}</span>
          </button>
          <button class="navlink navlink-section" class:active={view === 'roles'} onclick={() => go('roles')}>
            <span class="navico" aria-hidden="true"><Icon kind="role" /></span><span class="navlabel">Roles</span><span class="navcount">{pkg.roles.length}</span>
          </button>
          <button class="navlink navlink-section" class:active={view === 'locations'} onclick={() => go('locations')}>
            <span class="navico" aria-hidden="true"><Icon kind="location" /></span><span class="navlabel">Locations</span><span class="navcount">{pkg.locations.length}</span>
          </button>
          <button class="navlink navlink-section" class:active={view === 'items'} onclick={() => go('items')}>
            <span class="navico" aria-hidden="true"><Icon kind="item" /></span><span class="navlabel">Items</span><span class="navcount">{pkg.items.length}</span>
          </button>
          {#if attachments.length || editing}
            <button class="navlink navlink-section" class:active={view === 'files'} onclick={() => go('files')}>
              <span class="navico" aria-hidden="true"><Icon kind="file" /></span><span class="navlabel">Files</span><span class="navcount">{attachments.length}</span>
            </button>
          {/if}
        </div>
        {#if editing}
          <div class="navsep"></div>
          <button class="navlink navadd" onclick={addGuide}>+ New guide</button>
          <button class="navlink navadd" onclick={addGuideGroup}>+ New group</button>
        {/if}
      </nav>
      </div>

      <!-- Content -->
      <main class="content">
        {#snippet selectActions(ids, noun)}
          {#if editing && ids.length}
            {#if selectedIds.length}<button class="btn btn-small del-selected" onclick={() => deleteSelected(noun)}>Delete selected ({selectedIds.length})</button>{/if}
            <button class="btn btn-small" onclick={() => toggleSelectAll(ids)}>{allSelected(ids) ? 'Deselect all' : 'Select all'}</button>
          {/if}
        {/snippet}
        {#if currentGuide}
          <GuideView {pkg} guide={currentGuide} {lang} onOpen={openEntity} onTag={openTag} onView={(v) => go(v)} {editing} canEdit={!readOnly} onStartEditing={toggleEdit} onEdit={() => editEntity(currentGuide.id)} onDelete={() => removeEntity(currentGuide.id)} onToggleDraft={() => store.toggleGuideDraft(currentGuide.id)} onContent={(l, v) => store.setGuideContent(currentGuide.id, l, v)} onAddRef={(k, id) => store.addGuideRef(currentGuide.id, k, id)} onUploadMedia={(file) => uploadGuideMedia(currentGuide.id, file)} onTitle={(l, v) => store.setGuideTitle(currentGuide.id, l, v)} focusTitle={focusNewGuideTitle} onTitleFocused={() => (focusNewGuideTitle = false)} />
        {:else if view === 'start' && editing && pkg.guides.length === 0}
          <div class="card empty-hint">
            <span class="eyebrow">New plan</span>
            <h3 style="margin-top:6px">Start building</h3>
            <p class="soft small">Use the sections on the left to add <strong>People</strong>, <strong>Locations</strong> (countries, homes, safes…), <strong>Items</strong> (accounts, keys, documents), <strong>Files</strong>, and <strong>Guides</strong>. Everything auto-saves to this device — use <strong>Export</strong> for a copy on disk.</p>
          </div>

        {:else if view === 'access'}
          {@const steps = pathFor(audience)}
          <div class="access card">
            <span class="eyebrow">Your access path</span>
            <h1 class="access-h">Start here, {pkg.name(audience)}.</h1>
            <p class="soft">Take your time — there is no rush. When you're ready, follow these steps in order. If you're unsure at any point, stop and ask the person named in this plan.</p>
            <ol class="access-steps">
              {#each steps as st, i (st.id || i)}
                <li class="access-step">
                  <span class="access-num">{i + 1}</span>
                  <div class="access-body">
                    {#if st.text}<div class="access-text">{st.text}</div>{/if}
                    {#if st.ref_id && pkg.entity(st.ref_id)}
                      <button class="access-ref" onclick={() => openEntity(st.ref_id)}>{pkg.name(st.ref_id)} →</button>
                    {/if}
                    {#if st.photo_id && pkg.attachmentUrls[st.photo_id]}
                      <button class="access-photo" onclick={() => openEntity(st.photo_id)} title="Open photo">
                        <img src={pkg.attachmentUrls[st.photo_id]} alt={pkg.name(st.photo_id)} loading="lazy" />
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
            <div class="access-next">
              <button class="btn btn-primary" onclick={() => go('start')}>Continue to the guides →</button>
            </div>
          </div>

        {:else if view === 'people'}
          <div class="section-head">
            <h2 class="vh">People</h2>
            {#if editing}
              <div class="head-actions">
                {@render selectActions(peopleIds, 'people')}
                <button class="btn btn-small btn-primary" onclick={addPerson}>+ New</button>
              </div>
            {/if}
          </div>
          {#if pkg.people.length > 0}<FilterBar facets={peopleFacets} sorts={SORTS_NAME} bind:filters bind:sort={sortBy} bind:search={query} placeholder="Search people…" />{/if}
          <div class="ulist">
            {#each peopleResults as p, i (p.id)}
              <div class="ulist-row">
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(p.id)} onclick={(e) => rowSelect(peopleIds, i, e)} aria-label="Select" />{/if}
                <span class="list-row-ico" aria-hidden="true"><Icon kind="person" /></span>
                <button class="ulist-click" onclick={() => openEntity(p.id)}>
                  <span class="ulist-main">
                    <span class="ulist-name">{pkg.name(p.id)}{#if p.nickname}<span class="muted small"> · {p.name}</span>{:else if p.display_as}<span class="muted small"> · {p.display_as}</span>{/if}</span>
                    {#if personDesc(p)}<span class="ulist-desc">{personDesc(p)}</span>{/if}
                    {#if p.roles?.length}
                      <span class="person-roles" aria-label="Roles">
                        {#each p.roles as r}<span class="chip">{pkg.roleLabel(r)}</span>{/each}
                      </span>
                    {/if}
                  </span>
                </button>
                <span class="ulist-aside">
                  {#if editing}<button class="rowdel" title="Delete" aria-label="Delete" onclick={() => removeEntity(p.id)}><TrashIcon /></button>{/if}
                </span>
              </div>
            {:else}
              <p class="empty-results">{emptySearchLabel('people')}</p>
            {/each}
          </div>

        {:else if view === 'roles'}
          <div class="section-head">
            <h2 class="vh">Roles</h2>
            {#if editing}
              <div class="head-actions">
                {@render selectActions(roleIds, 'roles')}
                <button class="btn btn-small btn-primary" onclick={addRole}>+ New</button>
              </div>
            {/if}
          </div>
          {#if pkg.roles.length > 0}<FilterBar sorts={SORTS_NAME} bind:sort={sortBy} bind:search={query} placeholder="Search roles…" />{/if}
          <div class="ulist">
            {#each roleResults as role, i (role.id)}
              {@const usage = roleUsage(role.id)}
              <div class="ulist-row">
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(role.id)} onclick={(e) => rowSelect(roleIds, i, e)} aria-label="Select" />{/if}
                <span class="list-row-ico" aria-hidden="true"><Icon kind="role" /></span>
                <button class="ulist-click" onclick={() => rowClick(role.id)}>
                  <span class="ulist-main">
                    <span class="ulist-name">{pkg.name(role.id)}</span>
                    <span class="ulist-desc">{countLabel(usage.people, 'person', 'people')} · {countLabel(usage.guides, 'guide')}</span>
                  </span>
                </button>
                <span class="ulist-aside">
                  {#if editing}<button class="rowdel" title="Delete" aria-label="Delete" onclick={() => removeEntity(role.id)}><TrashIcon /></button>{/if}
                </span>
              </div>
            {:else}
              <p class="empty-results">{emptySearchLabel('roles')}</p>
            {/each}
          </div>

        {:else if view === 'locations'}
          <div class="section-head">
            <h2 class="vh">Locations</h2>
            {#if editing}
              <div class="head-actions">
                {@render selectActions(locIds, 'locations')}
                <button class="btn btn-small btn-primary" onclick={() => addLocation(null)}>+ New</button>
              </div>
            {/if}
          </div>
          {#if pkg.locations.length > 0}<FilterBar facets={locationFacets} bind:filters bind:search={query} placeholder="Search locations…" />{/if}
          <div class="ulist">
            {#each locationRows as { loc, depth }, i (loc.id)}
              {@const itemCount = (pkg.itemsAtLocation.get(loc.id) || []).length}
              <div
                class="ulist-row loc-row"
                class:nested={depth > 0}
                class:loc-before={locDrop?.id === loc.id && locDrop.pos === 'before'}
                class:loc-after={locDrop?.id === loc.id && locDrop.pos === 'after'}
                class:loc-inside={locDrop?.id === loc.id && locDrop.pos === 'inside'}
                class:dragging={locDrag === loc.id}
                style="--loc-depth:{depth}"
                draggable={editing && locReorderable}
                ondragstart={(e) => locDragStart(e, loc.id)}
                ondragend={locDragEnd}
                ondragover={(e) => locOver(e, loc)}
                ondrop={(e) => locDropOn(e, loc)}
                role="presentation"
              >
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(loc.id)} onclick={(e) => rowSelect(locIds, i, e)} aria-label="Select" />{/if}
                {#if editing}<span class="grip loc-grip" aria-hidden="true">⠿</span>{/if}
                <span class="list-row-ico" aria-hidden="true"><Icon kind="location" /></span>
                <button class="ulist-click" onclick={() => rowClick(loc.id)}>
                  <span class="ulist-main">
                    <span class="ulist-name">{pkg.name(loc.id)}</span>
                    {#if itemCount}<span class="ulist-desc">{countLabel(itemCount, 'item')}</span>{/if}
                  </span>
                </button>
                <span class="ulist-aside">
                  <Importance level={loc.importance} compact />
                  {#if editing}
                    <button class="rowadd" title="Add a location inside this one" onclick={() => addLocation(loc.id)}>+</button>
                    <button class="rowdel" title="Delete" onclick={() => removeEntity(loc.id)}><TrashIcon /></button>
                  {/if}
                </span>
              </div>
            {:else}
              <p class="empty-results">{emptySearchLabel('locations')}</p>
            {/each}
            {#if editing && locDrag && locReorderable}
              <div class="navend" class:drop-on={locDrop?.pos === 'end'} ondragover={locEndOver} ondrop={locEndDrop} role="presentation">Move to top level (end)</div>
            {/if}
          </div>

        {:else if view === 'items'}
          <div class="section-head">
            <h2 class="vh">Items</h2>
            {#if editing}
              <div class="head-actions">
                {@render selectActions(itemIds, 'items')}
                <button class="btn btn-small btn-primary" onclick={addItem}>+ New</button>
              </div>
            {/if}
          </div>
          {#if pkg.items.length > 0}<FilterBar facets={itemFacets} sorts={SORTS_IMP} bind:filters bind:sort={sortBy} bind:search={query} placeholder="Search items…" />{/if}
          <div class="ulist">
            {#each itemResults as it, i (it.id)}
              <div class="ulist-row">
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(it.id)} onclick={(e) => rowSelect(itemIds, i, e)} aria-label="Select" />{/if}
                <span class="list-row-ico" aria-hidden="true"><Icon kind="item" /></span>
                <button class="ulist-click" onclick={() => rowClick(it.id)}>
                  <span class="ulist-main">
                    <span class="ulist-name">{pkg.name(it.id)}{#if it.sensitive}<span class="lock-dot" title="sensitive"> ●</span>{/if}</span>
                    {#if it.description}<span class="ulist-desc">{it.description}</span>{/if}
                  </span>
                </button>
                <span class="ulist-aside">
                  {#if pkg.attachmentsByItem.has(it.id)}<span class="clip-ico" title="Has attachments" aria-label="Has attachments"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg></span>{/if}
                  {#if it.price}<span class="muted small">{it.price}</span>{/if}
                  <Importance level={it.importance} compact />
                  {#if editing}<button class="rowdel" title="Delete" onclick={() => removeEntity(it.id)}><TrashIcon /></button>{/if}
                </span>
              </div>
            {:else}
              <p class="empty-results">{emptySearchLabel('items')}</p>
            {/each}
          </div>

        {:else if view === 'map'}
          <div class="map-row">
            <div class="map-col">
              <div class="section-head"><h2 class="vh">Map</h2></div>
              {#if canSeeMap}
                <MapView {pkg} onOpen={openEntity} />
              {:else}
                <p class="empty-results">Map is not available for this reader.</p>
              {/if}
            </div>
            {#if editing}
              <aside class="map-side no-print">
                <button class="iconbtn" data-tip="Map settings (who can see it)" aria-label="Map settings" onclick={openMapSettings}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                </button>
              </aside>
            {/if}
          </div>

        {:else if view === 'search'}
          <div class="section-head"><h2 class="vh">Search</h2></div>
          {#if gquery.trim() && searchResults.length}
            <p class="tiny muted gs-count">{searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “{gquery.trim()}”</p>
            <div class="ulist">
              {#each searchResults as r (r.id)}
                <div class="ulist-row">
                  <span class="search-result-ico" aria-hidden="true">
                    <Icon kind={r.kind === 'attachment' ? 'file' : r.kind} />
                  </span>
                  <button class="ulist-click" onclick={() => pickResult(r.id)}>
                    <span class="ulist-main">
                      <span class="ulist-name">{r.name}</span>
                      <span class="ulist-desc">{KIND_LABEL[r.kind]}{r.inGuide ? ' · in a guide' : ''}</span>
                    </span>
                  </button>
                  <span class="ulist-aside">{#if r.importance && r.kind !== 'person'}<Importance level={r.importance} compact />{/if}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty-results">No matches{gquery.trim() ? ` for “${gquery.trim()}”` : ''}.</p>
          {/if}

        {:else if view === 'readiness' && canSeeReadiness}
          <ReadinessView
            {pkg}
            {editing}
            checks={readinessChecks}
            {selectedIds}
            onSelect={rowSelect}
            onOpen={rowClick}
            onDelete={removeEntity}
            onAdd={addReadiness}
            onBulkTag={(ids, tag) => store.addTagToReadinessChecks(ids, tag)}
            runs={readinessRuns}
            onDeleteRun={deleteReadinessRun}
            onDeleteRuns={deleteReadinessRuns}
            onOpenRun={openReadinessRun}
            selectActions={selectActions}
          />

        {:else if view === 'files'}
          <div class="section-head">
            <h2 class="vh">Files</h2>
            {#if editing}
              <div class="head-actions">
                {@render selectActions(fileIds, 'files')}
                <button class="btn btn-small btn-primary" onclick={() => fileInput?.click()}>+ New</button>
              </div>
            {/if}
          </div>
          {#if attachments.length > 0}<FilterBar facets={fileFacets} sorts={SORTS_NAME} bind:filters bind:sort={sortBy} bind:search={query} placeholder="Search files…" />{/if}
          {#if editing && selectedIds.length}
            <div class="bulk-tag">
              <span class="tiny muted">Tag {selectedIds.length} selected:</span>
              <input class="bulk-input" list="alltags" bind:value={bulkTag} placeholder="e.g. tax" onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), applyBulkTag())} />
              <datalist id="alltags">{#each pkg.allTags() as t}<option value={t}></option>{/each}</datalist>
              <button class="btn btn-small" onclick={applyBulkTag} disabled={!bulkTag.trim()}>Add tag</button>
            </div>
          {/if}
          <div class="ulist">
            {#each fileResults as att, i (att.id)}
              <div class="ulist-row">
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(att.id)} onclick={(e) => rowSelect(fileIds, i, e)} aria-label="Select" />{/if}
                <span class="list-row-ico" aria-hidden="true"><Icon kind={fileType(att) === 'image' ? 'image' : fileType(att) === 'video' ? 'video' : fileType(att) === 'pdf' ? 'pdf' : 'file'} /></span>
                <button class="ulist-click" onclick={() => rowClick(att.id)}>
                  <span class="ulist-main">
                    <span class="ulist-name">{pkg.name(att.id)}</span>
                    <span class="ulist-desc">{att.description || att.path}</span>
                    {#if att.tags?.length}<span class="row-tags">{#each att.tags as t}<span class="row-tag"># {t}</span>{/each}</span>{/if}
                  </span>
                </button>
                <span class="ulist-aside">
                  {#if editing}<button class="rowdel" title="Delete" onclick={() => removeEntity(att.id)}><TrashIcon /></button>{/if}
                </span>
              </div>
            {:else}
              <p class="empty-results">{emptySearchLabel('files')}</p>
            {/each}
          </div>
        {/if}
      </main>
    </div>
  {/if}

  {#if editing}<input bind:this={fileInput} type="file" multiple hidden onchange={onFile} />{/if}

  {#if drawerId}
    <Drawer {pkg} {store} {editing} showReadiness={canShowReadinessData} id={drawerId} onOpen={openEntity} onClose={closeDrawer} onBack={drawerBack} canBack={drawerStack.length > 0} onDelete={removeEntity} onTag={openTag} onView={(v) => go(v)} {requestConfirm} {requestNotice} />
  {/if}

  {#if dryRun && dryRunId}
    <DryRunPanel {pkg} {store} runId={dryRunId} personId={audience} {adminLabel} onSubmit={submitDryRun} onCancel={cancelDryRun} />
  {/if}

  {#if showExport}
    <ExportDialog data={store.data} blobs={store.attachmentBlobs} onClose={() => (showExport = false)} />
  {/if}

  <ConfirmDialog prompt={modalPrompt} onResolve={resolveModal} />
</div>

<style>
  .shell { min-height: 100vh; --reader-section-gap: 18px; --topbar-h: 58px; }
  .topbar {
    position: sticky; top: 0; z-index: var(--z-topbar);
    background: color-mix(in oklch, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--rule-soft);
  }
  .bar {
    /* Full-bleed, like the panes below. First column: 16px pad + 270px + 32px
       gap = 318px, so the plan title starts exactly where the content pane's
       inner edge does (290px rail + 28px pane padding). With the action rail,
       everything shifts 65px right. */
    padding: 10px 20px 10px 16px;
    display: grid;
    grid-template-columns: 270px minmax(240px, 340px) minmax(0, 1fr);
    gap: 32px;
    align-items: center;
  }
  /* With the rail: the logo owns the rail's 65px, so the plan title starts
     exactly at the rail's right edge; the search column still starts at the
     content pane's inner edge (65 + 290 + 2 borders + 28 = 385 = 353 + 32). */
  .with-actions .bar { grid-template-columns: 353px minmax(240px, 340px) minmax(0, 1fr); padding-left: 0; }
  .with-actions .bar-plan { gap: 14px; }
  .with-actions .brand-home { width: 65px; justify-content: center; margin-right: -14px; }
  .bar-plan { min-width: 0; display: flex; align-items: center; gap: 14px; }
  .bar-actions { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
  .brand { font-weight: 500; gap: 10px; }
  .brand-home { flex: none; display: inline-flex; padding: 2px; border-radius: 6px; }
  .brand-home:hover { background: var(--accent-wash); }
  .logo { width: 24px; height: 24px; display: block; }
  .plan-title {
    min-width: 0; max-width: 44vw;
    color: var(--ink); font-size: 15px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .plan-title-input {
    min-width: 0; width: min(360px, 40vw);
    font: inherit; font-size: 15px; font-weight: 500; color: var(--ink);
    background: transparent; border: 1px solid transparent; border-radius: 7px;
    padding: 5px 9px; margin: -3px -2px;
  }
  .plan-title-input:hover { border-color: var(--rule); }
  .plan-title-input:focus { outline: none; border-color: var(--accent); background: var(--paper); }
  .reader-tools { display: inline-flex; align-items: center; gap: 8px; }
  .sel-wrap { display: inline-flex; align-items: center; gap: 8px; }

  /* Global search box + dropdown */
  .gs-count { margin-bottom: 12px; }

  /* ---- The heir's access path (their first screen) ---- */
  /* Stretches like a guide — the accent rule marks it as auto-generated.
     No card frame: the white pane is the sheet. */
  .access { border: 0; border-left: 2px solid var(--accent); padding: 34px 36px; flex: 1; }
  .access-h { font-size: clamp(24px, 3.4vw, 34px); margin: 8px 0 12px; }
  .access-steps { list-style: none; padding: 0; margin: 24px 0 8px; display: flex; flex-direction: column; }
  .access-step { display: flex; gap: 16px; padding: 16px 0; border-top: 1px solid var(--rule-soft); }
  .access-num {
    flex: none; width: 28px; height: 28px; margin-top: 1px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--accent-wash); color: var(--accent-deep); font-weight: 600; font-size: 14px;
  }
  .access-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .access-text { font-size: 15.5px; line-height: 1.6; }
  .access-ref { align-self: flex-start; font-size: 13.5px; color: var(--accent-deep); text-decoration: underline; text-underline-offset: 3px; padding: 0; }
  .access-photo { align-self: flex-start; max-width: 340px; padding: 0; border: 1px solid var(--rule-soft); }
  .access-photo img { width: 100%; display: block; }
  .access-next { margin-top: 22px; }
  .navlink-access { display: inline-flex; align-items: center; gap: 8px; color: var(--accent-deep); font-weight: 500; }
  .sel {
    appearance: none; -webkit-appearance: none;
    border: 1px solid var(--rule); border-radius: 0;
    padding: 7px 26px 7px 12px;
    background: var(--paper) no-repeat right 9px center;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23667788' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-size: 11px;
    font: inherit; font-size: 13px; color: var(--ink); cursor: pointer;
  }
  .sel:hover { border-color: var(--accent-deep); }
  .lang { font-weight: 500; }
  /* .iconbtn is global (app.css) — the bare pattern from DESIGN.md. */


  /* The workspace: two panes sharing one 1px border, no gaps, no outer
     gutters — and never shorter than the viewport, so the rail always
     touches the bottom of the browser window. */
  .body {
    display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 0;
    padding: 0; align-items: stretch;
    min-height: calc(100vh - var(--topbar-h));
  }
  .with-actions .body { grid-template-columns: 64px 290px minmax(0, 1fr); }
  .railcol { background: var(--paper); border-right: 1px solid var(--rule-soft); }
  /* The action rail: the leftmost pane, verbs only. */
  .actionbar { background: var(--paper); border-right: 1px solid var(--rule-soft); }
  .actionbar-in {
    position: sticky; top: var(--topbar-h);
    height: calc(100vh - var(--topbar-h));
    display: flex; flex-direction: column; align-items: stretch; gap: 4px;
    padding: 10px 6px 14px;
  }
  .aspacer { flex: 1; }
  .abtn {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 9px 2px 7px; border-radius: 0;
    color: var(--ink-soft);
    transition: background .12s, color .12s;
  }
  .abtn span { font-family: var(--mono, inherit); font-size: 9.5px; letter-spacing: 0.04em; }
  .abtn:hover:not(:disabled) { background: color-mix(in oklch, var(--ink) 5%, var(--paper)); color: var(--ink); }
  .abtn.on { background: var(--accent-wash); color: var(--accent-deep); box-shadow: inset 2px 0 0 var(--accent-deep); }
  .abtn:disabled { opacity: 0.4; cursor: not-allowed; }
  .nav {
    display: flex; flex-direction: column; gap: 1px;
    padding: 10px 0 16px;
    position: sticky;
    /* Sits flush under the sticky top bar and holds while you scroll. */
    top: var(--topbar-h);
    max-height: calc(100vh - var(--topbar-h));
    overflow-y: auto;
    /* Reserve a real gutter for the scrollbar so it never overlaps the counts
       or delete buttons on the right edge. Styling ::-webkit-scrollbar makes it
       a space-taking (non-overlay) bar in Chromium/WebKit; Firefox uses the
       scrollbar-* shorthands. */
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
  }
  .nav::-webkit-scrollbar { width: 12px; }
  .nav::-webkit-scrollbar-track { background: transparent; }
  .nav::-webkit-scrollbar-thumb {
    background: var(--rule); border-radius: 999px;
    border: 3px solid var(--paper); background-clip: padding-box;
  }
  .nav::-webkit-scrollbar-thumb:hover { background: var(--ink-mute); background-clip: padding-box; }
  .navlink {
    text-align: left; padding: 8px 16px; border-radius: 0; color: var(--ink-soft); font-size: 14px;
    transition: background .12s, color .12s;
  }
  .navlink:hover { background: color-mix(in oklch, var(--ink) 5%, var(--paper)); color: var(--ink); }
  .navlink.active { background: var(--accent-wash); color: var(--accent-deep); font-weight: 500; box-shadow: inset 2px 0 0 var(--accent-deep); }
  .before-group-zone {
    height: 0; margin: 0; border-radius: 4px;
    border: 1px dashed transparent; pointer-events: none;
    transition: height .1s, background .1s, border-color .1s;
  }
  .before-group-zone.armed { height: 14px; margin: 2px 0; border-color: var(--rule); pointer-events: auto; }
  .before-group-zone.active { background: var(--accent-deep); border-color: transparent; }
  .end-zone {
    height: 0; margin: 0; border-radius: 4px;
    border: 1px dashed transparent; pointer-events: none;
    transition: height .1s, border-color .1s, background .1s;
  }
  .end-zone.armed { height: 14px; margin: 4px 0 0; border-color: var(--rule); pointer-events: auto; }
  .end-zone.active { background: var(--accent-deep); border-color: transparent; }
  .navgroup { display: flex; flex-direction: column; gap: 2px; margin: 4px 0; }
  .navgroup-read-title { padding-left: 0; }
  .navgroup-title {
    display: flex; align-items: center; gap: 2px;
    padding: 10px 12px 4px 16px;
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .navgroup-title .group-grip {
    width: 14px; flex: none;
    font-size: 14px;
    margin-right: 4px;
    color: var(--ink-mute);
    opacity: 0.55;
    cursor: grab;
  }
  .navgroup-input {
    flex: 1;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 3px 5px;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .navgroup-input:focus { outline: none; border-color: var(--accent); background: var(--paper); color: var(--ink); }
  .navguide-grip { flex: none; padding: 2px 3px; color: var(--ink-mute); opacity: 0.5; cursor: grab; touch-action: none; }
  .navguide-grip:hover { opacity: 1; color: var(--accent-deep); }
  .navguide-grip:active { cursor: grabbing; }
  .navguide-input {
    flex: 1; min-width: 0;
    font: inherit; font-size: 14px; line-height: 1.45;
    border: 1px solid transparent; border-radius: 6px;
    padding: 7px 10px; background: transparent; color: var(--ink-soft);
    text-align: left; cursor: pointer;
  }
  .navguide-input:hover { background: var(--accent-wash); color: var(--ink); }
  .navguide-input:focus { outline: none; border-color: var(--accent); background: var(--paper); color: var(--ink); cursor: text; }
  .navguide-input.active { background: var(--accent-wash); color: var(--accent-deep); font-weight: 500; }
  .navgroup-items { display: flex; flex-direction: column; gap: 2px; }
  .navgroup-items .navrow { padding-left: 16px; }
  /* Edit mode hierarchy: a root-level guide's grip lines up with the group
     grips (both live at the root), and rows INSIDE a group sit 16px deeper —
     otherwise an ungrouped guide reads as a child of whatever group is above.
     13px, not the grid's 16px: the guide grip carries 3px of internal padding
     the group grip doesn't, so 13 puts the visible dots on the same pixel. */
  .nav.editing > .navrow { padding-left: 13px; }
  .nav.editing .navgroup-items .navrow { padding-left: 29px; }
  .navguide-child { padding-left: 10px; }
  .navlink-child { padding-left: 12px; }
  .navrow { display: flex; align-items: center; gap: 2px; padding-right: 12px; }
  .navrow .navlink { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .navdel { width: 24px; height: 24px; border-radius: 7px; font-size: 13px; opacity: 0; transition: opacity .12s; }
  .navrow:hover .navdel, .navdel:focus-visible { opacity: 1; }
  .navgroup-del {
    width: 24px; height: 24px; border-radius: 7px; flex: none; margin-left: auto;
    color: var(--ink-mute); border: 1px solid transparent; font-size: 13px; opacity: 0;
    display: inline-flex; align-items: center; justify-content: center;
    transition: opacity .12s;
  }
  .navgroup:hover .navgroup-del, .navgroup-del:focus-visible { opacity: 1; }
  .navgroup-del:hover { color: var(--warn); border-color: var(--rule); background: var(--paper); }
  .navsep { height: 1px; background: var(--rule-soft); margin: 8px 0; }
  .map-row { position: relative; flex: 1; display: flex; flex-direction: column; }
  .map-col { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 22px; }
  .map-side { position: absolute; top: 0; right: -52px; display: flex; flex-direction: column; gap: 8px; }

  /* drag & drop reordering */
  .navrow.dragging { opacity: 0.4; }
  /* Draft guides: dimmed/italic title + a small amber "Draft" tag, in both
     edit and read mode. (They are dropped entirely from heir exports.) */
  .navrow.is-draft .navguide-input,
  .navrow.is-draft .navlink { color: var(--ink-mute); font-style: italic; }
  .draft-mark { flex: none; display: inline-flex; align-items: center; margin-right: 8px; color: var(--draft); }
  .draft-mark svg { display: block; }
  .navgroup.dragging { opacity: 0.5; }
  .navrow.drop-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .navrow.drop-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .navgroup.drop-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .navgroup.drop-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .navgroup.drop-on { background: var(--accent-wash); border-radius: 8px; outline: 1px dashed var(--accent); }
  .navgroup-empty { padding: 6px 12px 6px 24px; font-style: italic; }
  .nav-empty-guides {
    padding: 9px 16px;
    color: var(--ink-mute);
    font-size: 13px;
    font-style: italic;
  }
  .navend {
    margin: 4px 2px; padding: 9px 12px; border-radius: 8px; font-size: 12px;
    color: var(--ink-mute); border: 1px dashed var(--rule); text-align: center;
  }
  .navend.drop-on { border-color: var(--accent-deep); color: var(--accent-deep); background: var(--accent-wash); }

  /* The content pane is itself the white sheet — same surface as the rail,
     joined at the 1px border. What used to be a floating card gap now reads
     as the pane's own inner padding, Productboard-style. */
  .content { min-width: 0; display: flex; flex-direction: column; gap: 22px; padding: var(--reader-section-gap) 28px 90px; background: var(--paper); }
  .vh { font-size: clamp(22px, 3vw, 30px); }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .head-actions { display: flex; align-items: center; gap: 8px; }
  .del-selected { color: var(--warn); border: 1px solid oklch(0.85 0.06 50); background: var(--paper); }
  .del-selected:hover { background: var(--warn-wash); }
  .rowcheck { flex: none; width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-deep); }
  /* Grouping wrapper only — stays out of layout so the row/column nav and the
     mobile horizontal nav both keep nav's own gap between links. */
  .navobjects { display: contents; }
  /* Object lists (and the Map) carry a leading type icon; guides do not. */
  .navlink-section { display: flex; align-items: center; gap: 11px; }
  .navico {
    flex: none; width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-mute);
  }
  .navlink-section:hover .navico { color: var(--ink-soft); }
  .navlink-section.active .navico { color: var(--accent-deep); }
  .navlabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The Map reads as a featured spatial overview, not just another row. */
  .navlink-map .navico { color: var(--accent-deep); }
  .navcount { margin-left: auto; padding-left: 8px; color: var(--ink-mute); font-size: 13px; font-variant-numeric: tabular-nums; }
  .navlink-section.active .navcount { color: var(--accent-deep); }
  .ulist-click { flex: 1; min-width: 0; display: flex; background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: inherit; }
  .person-roles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .rowdel { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); border: 1px solid transparent; flex: none; display: inline-flex; align-items: center; justify-content: center; }
  .rowdel:hover { color: var(--warn); border-color: var(--rule); background: var(--paper); }
  .rowadd { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); border: 1px solid transparent; flex: none; font-size: 16px; }
  .rowadd:hover { color: var(--accent-deep); border-color: var(--rule); background: var(--paper); }
  .list-row-ico,
  .search-result-ico {
    flex: none;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-mute);
    background: var(--accent-wash);
  }
  .navadd { color: var(--accent-deep); }
  /* Save state is announced to assistive tech but never shown on screen. */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .empty-hint { border-left: 2px solid var(--accent); }
  .empty-results { padding: 14px 16px; color: var(--ink-mute); font-size: 14px; }
  .bulk-tag { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 4px; padding: 10px 12px; background: var(--accent-wash); border-radius: 9px; }
  .bulk-input { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; background: var(--paper); color: var(--ink); }
  .bulk-input:focus { outline: none; border-color: var(--accent-deep); }
  .row-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
  .row-tag { font-size: 11px; color: var(--accent-deep); background: var(--accent-wash); border-radius: 5px; padding: 1px 6px; }

  /* location tree + drag-and-drop */
  .loc-row {
    position: relative;
    margin-left: calc(var(--loc-depth, 0) * 42px);
    width: calc(100% - (var(--loc-depth, 0) * 42px));
  }
  .loc-row.nested { border-left: 3px solid var(--accent-wash); border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .loc-row.nested::before {
    content: "";
    position: absolute;
    left: -25px;
    top: 50%;
    width: 22px;
    border-top: 1px solid var(--rule);
  }
  .loc-grip { width: 14px; flex: none; color: var(--ink-mute); opacity: 0.45; cursor: grab; align-self: center; }
  .loc-row:hover .loc-grip { opacity: 1; }
  .loc-row[draggable='true'] { cursor: grab; }
  .loc-row.dragging { opacity: 0.4; }
  .loc-row.loc-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .loc-row.loc-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .loc-row.loc-inside { background: var(--accent-wash); outline: 1px dashed var(--accent); border-radius: 8px; }
  @media (max-width: 820px) {
    /* minmax(0,…): the railcol wrapper isn't a scroll container itself, so
       without it the horizontal nav's intrinsic width would blow the column
       past the viewport. */
    .body, .with-actions .body { grid-template-columns: minmax(0, 1fr); gap: 0; min-height: 0; }
    .railcol { min-width: 0; }
    /* The action rail folds to a flush strip above the nav strip. */
    .actionbar { border-right: 0; border-bottom: 1px solid var(--rule-soft); }
    .actionbar-in { position: static; height: auto; flex-direction: row; padding: 4px 10px; gap: 2px; }
    .abtn { flex-direction: row; gap: 7px; padding: 7px 10px; }
    /* The invisible (opacity-0) tooltip bubble would poke past the right
       viewport edge in the horizontal strip — labels are visible here anyway. */
    .actionbar :global([data-tip])::after { display: none; }
    .bar, .with-actions .bar { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .bar-actions { justify-content: flex-start; flex-wrap: wrap; gap: 8px; }
    /* The rail folds to a horizontal strip under the top bar — still flush. */
    .railcol { border-right: 0; border-bottom: 1px solid var(--rule-soft); }
    .nav { position: static; max-height: none; flex-direction: row; overflow-x: auto; gap: 6px; padding: 6px 12px; }
    .content { padding: var(--reader-section-gap) 14px 60px; }
    .map-row { display: flex; flex-direction: column-reverse; }
    .map-side { position: static; flex-direction: row; justify-content: flex-end; margin-bottom: 6px; }
    .navgroup { flex: none; flex-direction: row; align-items: center; gap: 6px; margin: 0; }
    .navgroup-title { padding: 9px 0 9px 8px; white-space: nowrap; }
    .navgroup-items { flex-direction: row; gap: 6px; }
    .navsep { display: none; }
    .navlink { white-space: nowrap; }
    .navlink-child { padding-left: 12px; }
    .nav.editing > .navrow { padding-left: 0; } /* horizontal nav: no insets */
    .nav.editing .navgroup-items .navrow { padding-left: 16px; }
    .shell { --reader-section-gap: 12px; }
    .plan-title, .plan-title-input { max-width: 38vw; width: auto; }
    .sel-wrap .tiny { display: none; }
  }
</style>
