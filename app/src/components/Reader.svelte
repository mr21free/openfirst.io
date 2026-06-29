<script>
  import { untrack, tick } from 'svelte';
  import GuideView from './GuideView.svelte';
  import MapView from './MapView.svelte';
  import FilterBar from './FilterBar.svelte';
  import Drawer from './Drawer.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Importance from './Importance.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import logo from '../assets/logo.svg';
  import ExportDialog from './ExportDialog.svelte';
  import { langValue } from '../lib/package.js';

  let { store, onClose, readOnly = false } = $props();

  const pkg = $derived(store.pkg);
  const editing = $derived(!readOnly && store.mode === 'edit');

  function toggleEdit() {
    if (readOnly) return;
    if (editing) {
      store.stopEditing();
      // Owner previewing their own plan — skip the heir "who are you?" gate and
      // show everything; they can still preview a person via "Reading as".
      chosen = true;
    } else {
      store.startEditing();
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
  function addGuide() {
    const id = store.addGuide();
    closeDrawer();
    const g = pkg.guides.find((x) => x.id === id);
    view = g ? guideTarget(g) : id;
    focusNewGuideTitle = true;
    window.scrollTo({ top: 0 });
  }
  function openSettings() { store.startSettings(); setDrawer('__meta'); }
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

  async function removeEntity(id) {
    const entity = pkg.entity(id);
    const kind = entity?.kind === 'attachment' ? 'file' : (entity?.kind || 'item');
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

  let audience = $state(null);
  let chosen = $state(false);
  let view = $state('start');
  let drawerId = $state(null);
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
  const fileType = (a) => (a.mime || '').startsWith('image/') ? 'image' : ((a.mime || '') === 'application/pdf' || /\.pdf$/i.test(a.path || a.filename || '')) ? 'pdf' : 'other';
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
    { key: 'access', label: 'Who can access', test: (it, v) => (it.access_person_ids || []).includes(v), options: pkg.people.map((p) => ({ value: p.id, label: pkg.name(p.id), count: pkg.items.filter((it) => (it.access_person_ids || []).includes(p.id)).length })).filter((o) => o.count) }
  ]);
  const locHasItems = (loc) => (pkg.itemsAtLocation.get(loc.id) || []).length > 0;
  const locationFacets = $derived([
    impFacet(pkg.locations),
    { key: 'contents', label: 'Contents', test: (loc, v) => (v === 'has') === locHasItems(loc), options: [['has', 'Holds items'], ['empty', 'Empty']].map(([value, label]) => ({ value, label, count: pkg.locations.filter((l) => (value === 'has') === locHasItems(l)).length })).filter((o) => o.count) }
  ]);
  const fileFacets = $derived([
    { key: 'tag', label: 'Tag', test: (a, v) => (a.tags || []).includes(v), options: pkg.allTags().map((t) => ({ value: t, label: '# ' + t, count: pkg.attachmentsWithTag(t).length })) },
    { key: 'type', label: 'Type', test: (a, v) => fileType(a) === v, options: [['image', 'Images'], ['pdf', 'PDFs'], ['other', 'Other']].map(([value, label]) => ({ value, label, count: (pkg.attachments || []).filter((a) => fileType(a) === value).length })).filter((o) => o.count) }
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
  const guides = $derived(pkg.guidesFor(audience));
  const navGuides = $derived(guides);
  const groupDefs = $derived(pkg.guideGroups());

  const navBlocks = $derived.by(() => {
    const groups = new Map(groupDefs.map((d) => [d.id, { kind: 'group', id: d.id, title: langValue(d.name, d.raw?.name_i18n, lang), raw: d.raw, guides: [], order: d.order ?? Infinity }]));
    const blocks = [];
    for (const g of navGuides) {
      if (g.group) {
        let block = groups.get(g.group);
        if (!block) {
          block = { kind: 'group', id: g.group, title: guideGroupLabel(g.group), raw: null, guides: [], order: Infinity };
          groups.set(g.group, block);
        }
        block.guides.push(g);
        block.order = Math.min(block.order, g.order ?? Infinity);
      } else {
        blocks.push({ kind: 'guide', id: g.id, guide: g, order: g.order ?? Infinity });
      }
    }
    for (const block of groups.values()) {
      block.guides.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
      blocks.push(block);
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

  const homeGuide = $derived(guides[0] || null);
  const owner = $derived(pkg.owner);

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
  function go(v) { view = v; closeDrawer(); query = ''; selectedIds = []; anchorIndex = null; filters = {}; sortBy = defaultSort(v); bulkTag = ''; window.scrollTo({ top: 0 }); }
  function chooseAudience(id) { audience = id; chosen = true; view = 'start'; }
  function switchAudience(v) { audience = v === '__all' ? null : v; view = 'start'; drawerId = null; window.scrollTo({ top: 0 }); }

  $effect(() => {
    if (!pkg.languages.includes(lang)) lang = pkg.lang;
    pkg.lang = lang;
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

<div class="shell">
  <header class="topbar no-print">
    <div class="bar">
      {#if readOnly}
        <div class="brand row"><img class="logo" src={logo} alt="" aria-hidden="true" /><span class="plan-title" title={planTitle}>{planTitle}</span></div>
      {:else}
        <button class="brand-home" onclick={onClose} title="Back to start" aria-label="Back to start"><img class="logo" src={logo} alt="" aria-hidden="true" /></button>
        {#if editing && store.data?.package}
          <input class="plan-title-input" bind:value={store.data.package.title} placeholder="My inheritance plan" aria-label="Plan title" />
        {:else}
          <span class="plan-title" title={planTitle}>{planTitle}</span>
        {/if}
        {#if editing && !showGate}<span class="tiny muted edit-note">auto-saved to this device{store.savedAt ? ' ✓' : '…'}</span>{/if}
      {/if}
      <span class="spacer"></span>
      {#if chosen}
        <label class="sel-wrap" title="Read this plan as a particular person">
          <span class="tiny muted">Reading as</span>
          <select class="sel" value={audience ?? '__all'} onchange={(e) => switchAudience(e.target.value)}>
            <option value="__all">Everyone</option>
            {#each audiences as p}<option value={p.id}>{pkg.name(p.id)}</option>{/each}
          </select>
        </label>
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
        {#if !readOnly}
          <button class="iconbtn" class:editing-on={editing} class:plan-done={editing} class:plan-edit={!editing} title={editing ? 'Done editing — view the plan' : 'Edit this plan'} aria-label={editing ? 'Done editing' : 'Edit'} onclick={toggleEdit}>
            {#if editing}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
              </svg>
            {:else}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            {/if}
          </button>
        {/if}
        {#if pkg.languages.length > 1}
          <select class="sel lang" bind:value={lang} aria-label="Language" title="Language">
            {#each pkg.languages as l}<option value={l}>{l.toUpperCase()}</option>{/each}
          </select>
        {/if}
        {#if !readOnly}
          <button class="iconbtn" title="Export plan to disk" aria-label="Export" onclick={() => (showExport = true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        {/if}
        <button class="iconbtn" title={editing ? 'Finish editing to print' : 'Print'} aria-label="Print" disabled={editing} onclick={() => window.print()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
        </button>
        {#if !readOnly}
          <button class="iconbtn" title="Settings" aria-label="Settings" onclick={openSettings}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.08.1a2 2 0 0 1-3.84 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.1-.08a2 2 0 0 1 0-3.84L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.08-.1a2 2 0 0 1 3.84 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.08.36.28.7.6 1l.1.08a2 2 0 0 1 0 3.84L20 14c-.32.3-.52.64-.6 1Z" />
            </svg>
          </button>
        {/if}
      {/if}
    </div>
  </header>

  {#if showGate}
    <!-- Who are you? -->
    <div class="gate container">
      <div class="card gate-card">
        <p class="eyebrow">Before we begin</p>
        <h1 class="gate-h">Take your time. There is no rush.</h1>
        <p class="soft">This plan was prepared by <strong>{owner?.name || 'the owner'}</strong>. So it can show you the right things first — who are you?</p>
        {#snippet whoBtn(p)}
          <button class="who" onclick={() => chooseAudience(p.id)}>
            <span class="who-name">{pkg.name(p.id)}{#if p.nickname} <span class="muted small">· {p.name}</span>{:else if p.display_as} <span class="muted small">· {p.display_as}</span>{/if}</span>
            <span class="row wrap">{#each p.roles as r}<span class="chip">{pkg.roleLabel(r)}</span>{/each}</span>
          </button>
        {/snippet}
        <div class="gate-people">
          {#each gatePrimary as p}{@render whoBtn(p)}{/each}
          {#if gatePrimary.length && gateRest.length}<div class="gate-sep" aria-hidden="true"></div>{/if}
          {#each gateRest as p}{@render whoBtn(p)}{/each}
        </div>
        <button class="btn btn-ghost" onclick={() => { audience = null; chosen = true; }}>Just show me everything</button>
      </div>
    </div>
  {:else}
    <div class="body container">
      <!-- Navigation -->
      <nav class="nav no-print">
        {#snippet draftMark()}
          <span class="draft-mark" title="Draft — left out of the heir reader (.html)" aria-label="Draft">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </span>
        {/snippet}
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
                  >
                    {#if editing}
                      <span class="grip navguide-grip" title="Drag to reorder" draggable="true" ondragstart={(e) => dragStart(e, g.id)} ondragend={dragClear}>⠿</span>
                      <input class="navguide-input navguide-child" class:active={view === target} value={langValue(g.title, g.title_i18n, lang)} oninput={(e) => store.setGuideTitle(g.id, lang, e.target.value)} onclick={() => go(target)} placeholder="Guide name" aria-label="Guide name" />
                      {#if g.draft}{@render draftMark()}{/if}
                      <button class="rowdel navdel" title="Delete" aria-label="Delete guide" onclick={() => removeEntity(g.id)}><TrashIcon /></button>
                    {:else}
                      <button
                        class="navlink navlink-child"
                        class:active={view === target}
                        onclick={() => go(target)}
                      >{langValue(g.title, g.title_i18n, lang)}</button>
                      {#if g.draft}{@render draftMark()}{/if}
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
            >
              {#if editing}
                <span class="grip navguide-grip" title="Drag to reorder" draggable="true" ondragstart={(e) => dragStart(e, entry.guide.id)} ondragend={dragClear}>⠿</span>
                <input class="navguide-input" class:active={view === target} value={langValue(entry.guide.title, entry.guide.title_i18n, lang)} oninput={(e) => store.setGuideTitle(entry.guide.id, lang, e.target.value)} onclick={() => go(target)} placeholder="Guide name" aria-label="Guide name" />
                {#if entry.guide.draft}{@render draftMark()}{/if}
                <button class="rowdel navdel" title="Delete" aria-label="Delete guide" onclick={() => removeEntity(entry.guide.id)}><TrashIcon /></button>
              {:else}
                <button class="navlink" class:active={view === target} onclick={() => go(target)}>{langValue(entry.guide.title, entry.guide.title_i18n, lang)}</button>
                {#if entry.guide.draft}{@render draftMark()}{/if}
              {/if}
            </div>
          {/if}
        {/each}
        {#if editing}
          <!-- End drop target: lets a guide (or group) land after the last
               block — e.g. after a trailing group. Always present so arming it
               can't reparent/cancel the active drag. -->
          <div class="end-zone" class:armed={!!drag} class:active={dropEnd} ondragover={endOver} ondrop={endDrop} role="presentation"></div>
        {/if}
        <div class="navsep"></div>
        {#if pkg.locations.length || pkg.items.length}
          <button class="navlink navlink-section" class:active={view === 'map'} onclick={() => go('map')}>Map</button>
          <div class="navsep"></div>
        {/if}
        <button class="navlink navlink-section" class:active={view === 'people'} onclick={() => go('people')}>People<span class="navcount">{pkg.people.length}</span></button>
        <button class="navlink navlink-section" class:active={view === 'roles'} onclick={() => go('roles')}>Roles<span class="navcount">{pkg.roles.length}</span></button>
        <button class="navlink navlink-section" class:active={view === 'locations'} onclick={() => go('locations')}>Locations<span class="navcount">{pkg.locations.length}</span></button>
        <button class="navlink navlink-section" class:active={view === 'items'} onclick={() => go('items')}>Items<span class="navcount">{pkg.items.length}</span></button>
        {#if attachments.length || editing}
          <button class="navlink navlink-section" class:active={view === 'files'} onclick={() => go('files')}>Files<span class="navcount">{attachments.length}</span></button>
        {/if}
        {#if editing}
          <div class="navsep"></div>
          <button class="navlink navadd" onclick={addGuide}>+ New guide</button>
          <button class="navlink navadd" onclick={addGuideGroup}>+ New group</button>
        {/if}
      </nav>

      <!-- Content -->
      <main class="content">
        {#snippet selectActions(ids, noun)}
          {#if editing && ids.length}
            {#if selectedIds.length}<button class="btn btn-small del-selected" onclick={() => deleteSelected(noun)}>Delete selected ({selectedIds.length})</button>{/if}
            <button class="btn btn-small" onclick={() => toggleSelectAll(ids)}>{allSelected(ids) ? 'Deselect all' : 'Select all'}</button>
          {/if}
        {/snippet}
        {#if currentGuide}
          <GuideView {pkg} guide={currentGuide} {lang} onOpen={openEntity} onTag={openTag} {editing} canEdit={!readOnly} onStartEditing={toggleEdit} onEdit={() => editEntity(currentGuide.id)} onDelete={() => removeEntity(currentGuide.id)} onToggleDraft={() => store.toggleGuideDraft(currentGuide.id)} onContent={(l, v) => store.setGuideContent(currentGuide.id, l, v)} onAddRef={(k, id) => store.addGuideRef(currentGuide.id, k, id)} onTitle={(l, v) => store.setGuideTitle(currentGuide.id, l, v)} focusTitle={focusNewGuideTitle} onTitleFocused={() => (focusNewGuideTitle = false)} />
        {:else if view === 'start' && editing && pkg.guides.length === 0}
          <div class="card empty-hint">
            <span class="eyebrow">New plan</span>
            <h3 style="margin-top:6px">Start building</h3>
            <p class="soft small">Use the sections on the left to add <strong>People</strong>, <strong>Locations</strong> (countries, homes, safes…), <strong>Items</strong> (accounts, keys, documents), <strong>Files</strong>, and <strong>Guides</strong>. Everything auto-saves to this device — use <strong>Export</strong> for a copy on disk.</p>
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
                style="margin-left:{depth * 24}px"
                draggable={editing && locReorderable}
                ondragstart={(e) => locDragStart(e, loc.id)}
                ondragend={locDragEnd}
                ondragover={(e) => locOver(e, loc)}
                ondrop={(e) => locDropOn(e, loc)}
              >
                {#if editing}<input type="checkbox" class="rowcheck" checked={selectedIds.includes(loc.id)} onclick={(e) => rowSelect(locIds, i, e)} aria-label="Select" />{/if}
                {#if editing}<span class="grip loc-grip" aria-hidden="true">⠿</span>{/if}
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
          <div class="section-head"><h2 class="vh">Map</h2></div>
          <MapView {pkg} onOpen={openEntity} />

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
    <Drawer {pkg} {store} {editing} id={drawerId} onOpen={openEntity} onClose={closeDrawer} onBack={drawerBack} canBack={drawerStack.length > 0} onDelete={removeEntity} {requestConfirm} {requestNotice} />
  {/if}

  {#if showExport}
    <ExportDialog data={store.data} blobs={store.attachmentBlobs} onClose={() => (showExport = false)} />
  {/if}

  <ConfirmDialog prompt={modalPrompt} onResolve={resolveModal} />
</div>

<style>
  .shell { min-height: 100vh; --reader-section-gap: 18px; }
  .topbar {
    background: color-mix(in oklch, var(--paper) 88%, transparent);
    border-bottom: 1px solid var(--rule-soft);
  }
  .bar { max-width: var(--maxw); margin: 0 auto; padding: 10px 28px; display: flex; align-items: center; gap: 14px; }
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
  .iconbtn.editing-on { color: var(--accent-deep); background: var(--accent-wash); }
  .sel-wrap { display: inline-flex; align-items: center; gap: 8px; }
  .sel {
    appearance: none; -webkit-appearance: none;
    border: 1px solid var(--rule); border-radius: 999px;
    padding: 7px 26px 7px 12px;
    background: var(--paper) no-repeat right 9px center;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23667788' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-size: 11px;
    font: inherit; font-size: 13px; color: var(--ink); cursor: pointer;
  }
  .sel:hover { border-color: var(--accent-deep); }
  .lang { font-weight: 500; }
  .iconbtn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 999px;
    border: 1px solid transparent; color: var(--ink-soft); flex: none;
    transition: color .12s, border-color .12s, background .12s;
  }
  .iconbtn:hover { color: var(--ink); border-color: var(--rule); background: var(--paper); }
  .iconbtn:disabled { opacity: 0.4; cursor: not-allowed; }
  .iconbtn:disabled:hover { color: var(--ink-soft); border-color: transparent; background: transparent; }

  .gate { display: block; padding: var(--reader-section-gap) 28px 64px; }
  .gate-card { width: 100%; border-left: 2px solid var(--accent); }
  .gate-h { font-size: clamp(26px, 4vw, 38px); margin: 8px 0 14px; }
  .gate-people { display: grid; gap: 12px; margin: 22px 0; }
  .gate-sep { height: 1px; background: var(--rule-soft); margin: 2px 0; }
  .who {
    display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
    border: 1px solid var(--rule); border-radius: 12px; padding: 16px; text-align: left;
    transition: border-color .12s, background .12s;
  }
  .who:hover { border-color: var(--accent-deep); background: var(--accent-wash); }
  .who-name { font-size: 17px; font-weight: 500; }

  /* stretch: the content column grows to match the (usually taller) sticky
     nav, so a short/empty guide fills exactly to the menu's height — no more. */
  .body { display: grid; grid-template-columns: 290px 1fr; gap: 32px; padding: var(--reader-section-gap) 28px 90px; align-items: stretch; }
  .nav {
    display: flex; flex-direction: column; gap: 2px;
    background: color-mix(in oklch, var(--accent-wash) 22%, var(--paper));
    border: 1px solid var(--rule-soft);
    border-radius: 14px;
    padding: 12px 10px;
    align-self: start;
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
  }
  .navlink {
    text-align: left; padding: 9px 12px; border-radius: 8px; color: var(--ink-soft); font-size: 14px;
    transition: background .12s, color .12s;
  }
  .navlink:hover { background: var(--accent-wash); color: var(--ink); }
  .navlink.active { background: var(--accent-wash); color: var(--accent-deep); font-weight: 500; }
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
  .navgroup-read-title { padding-left: 12px; }
  .navgroup-title {
    display: flex; align-items: center; gap: 2px;
    padding: 8px 0 2px 0;
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
    font: inherit; font-size: 14px;
    border: 1px solid transparent; border-radius: 6px;
    padding: 7px 10px; background: transparent; color: var(--ink-soft);
    text-align: left; cursor: pointer;
  }
  .navguide-input:hover { background: var(--accent-wash); color: var(--ink); }
  .navguide-input:focus { outline: none; border-color: var(--accent); background: var(--paper); color: var(--ink); cursor: text; }
  .navguide-input.active { background: var(--accent-wash); color: var(--accent-deep); font-weight: 500; }
  .navgroup-items { display: flex; flex-direction: column; gap: 2px; }
  .navgroup-items .navrow { padding-left: 16px; }
  .navguide-child { padding-left: 10px; }
  .navlink-child { padding-left: 12px; }
  .navrow { display: flex; align-items: center; gap: 2px; }
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
  .navsep { height: 1px; background: var(--rule-soft); margin: 10px 6px; }

  /* drag & drop reordering */
  .navrow[draggable='true'] { cursor: grab; }
  .navrow.dragging { opacity: 0.4; }
  /* Draft guides: dimmed/italic title + a small amber "Draft" tag, in both
     edit and read mode. (They are dropped entirely from heir exports.) */
  .navrow.is-draft .navguide-input,
  .navrow.is-draft .navlink { color: var(--ink-mute); font-style: italic; }
  .draft-mark { flex: none; display: inline-flex; align-items: center; color: var(--draft); }
  .draft-mark svg { display: block; }
  .navgroup.dragging { opacity: 0.5; }
  .navrow.drop-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .navrow.drop-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .navgroup.drop-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .navgroup.drop-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .navgroup.drop-on { background: var(--accent-wash); border-radius: 8px; outline: 1px dashed var(--accent); }
  .navgroup-empty { padding: 6px 12px 6px 24px; font-style: italic; }
  .navend {
    margin: 4px 2px; padding: 9px 12px; border-radius: 8px; font-size: 12px;
    color: var(--ink-mute); border: 1px dashed var(--rule); text-align: center;
  }
  .navend.drop-on { border-color: var(--accent-deep); color: var(--accent-deep); background: var(--accent-wash); }

  .content { min-width: 0; display: flex; flex-direction: column; gap: 22px; }
  .vh { font-size: clamp(22px, 3vw, 30px); }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .head-actions { display: flex; align-items: center; gap: 8px; }
  .del-selected { color: var(--warn); border: 1px solid oklch(0.85 0.06 50); background: var(--paper); }
  .del-selected:hover { background: var(--warn-wash); }
  .rowcheck { flex: none; width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-deep); }
  .navlink-section { display: flex; align-items: center; }
  .navcount { margin-left: auto; padding-left: 8px; color: var(--ink-mute); font-size: 13px; font-variant-numeric: tabular-nums; }
  .navlink-section.active .navcount { color: var(--accent-deep); }
  .btn-small { min-height: 34px; padding: 7px 12px; font-size: 13px; }
  .ulist-click { flex: 1; min-width: 0; display: flex; background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: inherit; }
  .person-roles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .rowdel { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); border: 1px solid transparent; flex: none; display: inline-flex; align-items: center; justify-content: center; }
  .rowdel:hover { color: var(--warn); border-color: var(--rule); background: var(--paper); }
  .rowadd { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); border: 1px solid transparent; flex: none; font-size: 16px; }
  .rowadd:hover { color: var(--accent-deep); border-color: var(--rule); background: var(--paper); }
  .navadd { color: var(--accent-deep); }
  .edit-note { flex: none; }
  .empty-hint { border-left: 2px solid var(--accent); }
  .empty-results { padding: 14px 16px; color: var(--ink-mute); font-size: 14px; }
  .bulk-tag { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 4px; padding: 10px 12px; background: var(--accent-wash); border-radius: 9px; }
  .bulk-input { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; background: var(--paper); color: var(--ink); }
  .bulk-input:focus { outline: none; border-color: var(--accent-deep); }
  .row-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
  .row-tag { font-size: 11px; color: var(--accent-deep); background: var(--accent-wash); border-radius: 5px; padding: 1px 6px; }

  /* location tree + drag-and-drop */
  .loc-row { position: relative; }
  .loc-row.nested { border-left: 2px solid var(--accent-wash); border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .loc-grip { width: 14px; flex: none; color: var(--ink-mute); opacity: 0.45; cursor: grab; align-self: center; }
  .loc-row:hover .loc-grip { opacity: 1; }
  .loc-row[draggable='true'] { cursor: grab; }
  .loc-row.dragging { opacity: 0.4; }
  .loc-row.loc-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .loc-row.loc-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .loc-row.loc-inside { background: var(--accent-wash); outline: 1px dashed var(--accent); border-radius: 8px; }
  @media (max-width: 820px) {
    .body { grid-template-columns: 1fr; gap: 16px; }
    .nav { position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 4px; }
    .navgroup { flex: none; flex-direction: row; align-items: center; gap: 6px; margin: 0; }
    .navgroup-title { padding: 9px 0 9px 8px; white-space: nowrap; }
    .navgroup-items { flex-direction: row; gap: 6px; }
    .navsep { display: none; }
    .navlink { white-space: nowrap; }
    .navlink-child { padding-left: 12px; }
    .shell { --reader-section-gap: 12px; }
    .plan-title, .plan-title-input { max-width: 38vw; width: auto; }
    .sel-wrap .tiny { display: none; }
  }
</style>
