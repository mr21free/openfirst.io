/*
  Reactive editable store for the whole package.

  - `data` is the raw, mutable, deeply-reactive source of truth.
  - `pkg` is a derived read-only InheritancePackage view (the Reader renders it).
  - In edit mode, any change to `data` is auto-saved to IndexedDB (debounced).
  Nothing leaves the device.
*/

import { InheritancePackage } from './package.js';
import { collectRoleIds, humanizeKey, normalizedRoles, slugifyTag } from './package.js';
import { saveDraft, clearDraft } from './persist.js';

const KINDS = ['people', 'locations', 'items', 'guides', 'folders', 'attachments'];
const today = () => new Date().toISOString().slice(0, 10);

// Content fingerprint that ignores the auto-managed package "updated" date.
function stableKey(snap) {
  const p = snap?.package ? { ...snap.package, updated: undefined } : snap?.package;
  return JSON.stringify({ ...snap, package: p });
}

export class Store {
  data = $state(null);
  attachmentUrls = $state({});
  mode = $state('read'); // 'read' | 'edit'
  editable = $state(false); // becomes true once editing starts → autosave on
  savedAt = $state(null);

  attachmentBlobs = new Map(); // id -> Blob (non-reactive; for export + persist)
  pkg = $derived(this.data ? new InheritancePackage(this.data, this.attachmentUrls) : null);

  #timer = null;
  #baseline = null; // last-seen content key (excluding the auto "updated" date)

  constructor() {
    // Auto-save on a real change while editing, and stamp the plan's "updated"
    // date automatically (never on mere open / no-op).
    $effect.root(() => {
      $effect(() => {
        if (!this.editable || !this.data) return;
        const key = stableKey($state.snapshot(this.data));
        if (this.#baseline === null) { this.#baseline = key; return; }
        if (key !== this.#baseline) {
          this.#baseline = key;
          if (this.data.package) this.data.package.updated = today();
          this.#scheduleSave($state.snapshot(this.data));
        }
      });
    });
  }

  load({ data, attachmentUrls = {}, blobs = new Map() }) {
    this.data = data;
    this.attachmentUrls = attachmentUrls;
    this.attachmentBlobs = blobs;
    this.mode = 'read';
    this.editable = false;
    this.savedAt = null;
    this.#baseline = null;
  }

  reset() {
    this.data = null;
    this.attachmentUrls = {};
    this.attachmentBlobs = new Map();
    this.mode = 'read';
    this.editable = false;
    this.#baseline = null;
  }

  ensureArrays() {
    if (!this.data) return;
    for (const k of KINDS) if (!Array.isArray(this.data[k])) this.data[k] = [];
    if (!this.data.package) this.data.package = {};
    if (!Array.isArray(this.data.package.languages) || !this.data.package.languages.length) this.data.package.languages = ['en'];
    if (!this.data.package.default_language) this.data.package.default_language = this.data.package.languages[0];
    this.ensureRoles();
    this.ensureGuideGroups();
  }

  ensureRoles() {
    if (!this.data) return;
    this.data.roles = normalizedRoles(this.data);
  }

  ensureGuideGroups() {
    if (!this.data) return;
    if (!Array.isArray(this.data.guide_groups)) this.data.guide_groups = [];
    const known = new Set(this.data.guide_groups.map((g) => g.id));
    for (const g of this.data.guides || []) {
      if (g.group && !known.has(g.group)) {
        known.add(g.group);
        this.data.guide_groups.push({ id: g.group, name: humanizeKey(g.group), order: g.order });
      }
    }
  }

  startEditing() {
    this.ensureArrays();
    // Normalize the guide-nav order space on entry so every drag operates on a
    // clean, gap-free sequence. Imported plans (e.g. the sample) can carry
    // fractional / colliding orders that make a root guide tie with a group;
    // this removes those ties up front. Done before `editable` so it doesn't
    // count as an edit.
    this.#renumberBlocks(this.#navBlocks());
    this.mode = 'edit';
    this.editable = true;
  }
  stopEditing() { this.mode = 'read'; }
  startSettings() {
    this.ensureArrays();
    if (this.#baseline === null) this.#baseline = stableKey($state.snapshot(this.data));
    this.editable = true;
  }

  #scheduleSave(snap) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(async () => {
      const attachments = [];
      for (const [id, blob] of this.attachmentBlobs) attachments.push({ id, blob });
      const at = new Date().toISOString();
      const ok = await saveDraft({ data: snap, attachments, savedAt: at });
      if (ok) this.savedAt = at;
    }, 600);
  }

  async discardDraft() { await clearDraft(this.data?.package?.id || 'current'); this.savedAt = null; }

  // ---- lookups ----
  /** The live (reactive) raw object for an id, for forms to bind to. */
  rawById(id) {
    if (!this.data) return null;
    for (const k of KINDS) { const o = this.data[k]?.find((x) => x.id === id); if (o) return o; }
    const role = this.data.roles?.find((x) => x.id === id);
    if (role) return role;
    return null;
  }

  genId(prefix) {
    const exists = (id) =>
      KINDS.some((k) => this.data[k]?.some((o) => o.id === id)) ||
      this.data.guide_groups?.some((o) => o.id === id) ||
      this.data.roles?.some((o) => o.id === id);
    let id;
    do { id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`; } while (exists(id));
    return id;
  }

  // ---- CRUD ----
  addPerson() {
    this.ensureArrays();
    const id = this.genId('person');
    this.data.people.push({ id, name: '', roles: [] });
    return id;
  }

  addLocation(parentId = null) {
    this.ensureArrays();
    const id = this.genId('loc');
    const order = this.#locSiblings(parentId).reduce((m, l) => Math.max(m, l.order ?? -1), -1) + 1;
    const loc = { id, name: '', order };
    if (parentId) loc.parent_id = parentId;
    this.data.locations.push(loc);
    return id;
  }

  #locSiblings(parentId) {
    const pid = parentId || null;
    return (this.data.locations || []).filter((l) => (l.parent_id || null) === pid);
  }

  /**
   * Move a location to a new parent / position (drag-and-drop). `parentId` is
   * the new parent (null = top level), `beforeId` the sibling it lands before
   * (null = end). Renumbers the destination siblings. Guards against cycles.
   */
  moveLocation(id, parentId = null, beforeId = null) {
    this.ensureArrays();
    const loc = this.data.locations.find((l) => l.id === id);
    if (!loc) return;
    const target = parentId || null;
    if (target === id) return;
    // No dropping a location inside its own descendant.
    let cur = target;
    const byId = new Map(this.data.locations.map((l) => [l.id, l]));
    while (cur) { if (cur === id) return; cur = byId.get(cur)?.parent_id || null; }

    if (target) loc.parent_id = target; else delete loc.parent_id;

    const ids = this.#locSiblings(target).map((l) => l.id).filter((x) => x !== id);
    const at = beforeId && beforeId !== id ? ids.indexOf(beforeId) : -1;
    if (at >= 0) ids.splice(at, 0, id); else ids.push(id);
    ids.forEach((lid, i) => { const l = byId.get(lid); if (l) l.order = i; });
  }

  addItem() {
    this.ensureArrays();
    const id = this.genId('item');
    this.data.items.push({ id, name: '' });
    return id;
  }

  addGuide() {
    this.ensureArrays();
    const id = this.genId('guide');
    const lang = this.data.package?.default_language || this.data.package?.languages?.[0] || 'en';
    // Append after the last nav block (root guide or group), then renumber, so
    // the new guide's order can't collide with a group's order.
    const order = this.#navBlocks().reduce((m, b) => Math.max(m, b.order ?? -1), -1) + 1;
    const titles = new Set(this.data.guides.map((g) => g.title));
    let title = 'New Guide';
    let n = 1;
    while (titles.has(title)) title = `New Guide (${n++})`;
    this.data.guides.push({ id, title, content: { [lang]: '' }, order, updated: today() });
    this.#renumberBlocks(this.#navBlocks());
    return id;
  }

  // ---- Guide nav groups + manual ordering (drag-and-drop) ----
  addGuideGroup(name) {
    this.ensureArrays();
    if (!Array.isArray(this.data.guide_groups)) this.data.guide_groups = [];
    const id = this.genId('grp');
    const order = this.#navBlocks().reduce((m, b) => Math.max(m, b.order ?? -1), -1) + 1;
    // Auto-name uniquely, same pattern as guides: "New group", "New group (1)"…
    if (!name) {
      const taken = new Set(this.data.guide_groups.map((g) => g.name));
      name = 'New group';
      let n = 1;
      while (taken.has(name)) name = `New group (${n++})`;
    }
    this.data.guide_groups.push({ id, name, order });
    this.#renumberBlocks(this.#navBlocks());
    return id;
  }

  /** Toggle a guide's draft flag. Draft guides are kept in the working plan but
   *  excluded from any heir-facing export (and any group they'd leave empty). */
  toggleGuideDraft(id) {
    this.ensureArrays();
    const g = this.data.guides.find((x) => x.id === id);
    if (!g) return;
    if (g.draft) delete g.draft; else g.draft = true;
  }

  /** Editor writes go through the store (which owns the data) so the content
   *  editor never mutates a prop it doesn't own. */
  setGuideContent(id, lang, value) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (!g.content) g.content = {};
    g.content[lang] = value;
  }
  addGuideRef(id, key, refId) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g || !key) return;
    if (!g.references) g.references = {};
    if (!g.references[key]) g.references[key] = [];
    if (!g.references[key].includes(refId)) g.references[key].push(refId);
  }

  #defaultLang() { return this.data?.package?.default_language || this.data?.package?.languages?.[0] || null; }

  /** Set a guide title for a language. The default language is the primary
   *  `title`; other languages are stored as overrides in `title_i18n`. */
  setGuideTitle(id, lang, value) {
    const g = this.data?.guides?.find((x) => x.id === id);
    if (!g) return;
    if (!lang || lang === this.#defaultLang()) { g.title = value; return; }
    if (!g.title_i18n) g.title_i18n = {};
    g.title_i18n[lang] = value;
  }

  /** Set a guide-group name for a language (primary `name` / `name_i18n`). */
  setGroupName(id, lang, value) {
    const grp = this.data?.guide_groups?.find((x) => x.id === id);
    if (!grp) return;
    if (!lang || lang === this.#defaultLang()) { grp.name = value; return; }
    if (!grp.name_i18n) grp.name_i18n = {};
    grp.name_i18n[lang] = value;
  }

  #navGuides() {
    return this.data.guides || [];
  }

  #groupDef(id) {
    this.ensureGuideGroups();
    return this.data.guide_groups.find((g) => g.id === id) || null;
  }

  #navBlocks() {
    this.ensureGuideGroups();
    const navGuides = this.#navGuides();
    const groups = new Map();
    for (const def of this.data.guide_groups || []) groups.set(def.id, { kind: 'group', id: def.id, def, guides: [], order: def.order });
    const blocks = [];
    for (const g of navGuides) {
      if (g.group) {
        const block = groups.get(g.group) || { kind: 'group', id: g.group, def: null, guides: [], order: Infinity };
        block.guides.push(g);
        block.order = Math.min(block.order ?? Infinity, g.order ?? Infinity);
        groups.set(g.group, block);
      } else {
        blocks.push({ kind: 'guide', id: g.id, guide: g, order: g.order ?? Infinity });
      }
    }
    for (const block of groups.values()) blocks.push(block);
    blocks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.kind + a.id).localeCompare(b.kind + b.id));
    for (const block of blocks) if (block.kind === 'group') block.guides.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    return blocks;
  }

  #renumberBlocks(blocks) {
    let order = 0;
    for (const block of blocks) {
      if (block.kind === 'group') {
        const def = this.#groupDef(block.id);
        if (def) def.order = order;
        for (const guide of block.guides) guide.order = order++;
        if (!block.guides.length) order++;
      } else {
        block.guide.order = order++;
      }
    }
  }

  /**
   * Move a guide to a new position / group. `group` is the destination group
   * (null = top level). `beforeId` is the guide it should land in front of
   * (null = end of that destination).
   *
   * Works on the ordered block list (root guides + groups) read while orders
   * are still consistent, then renumbers once — the same safe pattern as
   * `moveGuideGroup`. Never reorder from half-written `order` values: a group's
   * block position depends on both its own `order` and its guides', so a
   * partial update creates ties that would snap the guide back behind a group.
   */
  moveGuide(id, group = null, beforeId = null) {
    this.ensureArrays();
    const moved = this.#navGuides().find((g) => g.id === id);
    if (!moved) return;
    const dest = group || null;
    if (beforeId === id) beforeId = null;

    const blocks = this.#navBlocks();

    // 1. Detach the guide from wherever it currently sits.
    for (const b of blocks) if (b.kind === 'group') b.guides = b.guides.filter((g) => g.id !== id);
    const rootAt = blocks.findIndex((b) => b.kind === 'guide' && b.id === id);
    if (rootAt >= 0) blocks.splice(rootAt, 1);

    // 2. Update group membership.
    if (dest) moved.group = dest; else delete moved.group;

    // 3. Re-insert at the destination.
    if (dest) {
      const target = blocks.find((b) => b.kind === 'group' && b.id === dest);
      if (target) {
        const at = beforeId ? target.guides.findIndex((g) => g.id === beforeId) : -1;
        if (at >= 0) target.guides.splice(at, 0, moved); else target.guides.push(moved);
      }
    } else {
      // Top level: land before the block that owns `beforeId` — a root guide, or
      // the group that contains it — else at the end of the list.
      const at = beforeId
        ? blocks.findIndex((b) =>
            (b.kind === 'guide' && b.id === beforeId) ||
            (b.kind === 'group' && (b.id === beforeId || b.guides.some((g) => g.id === beforeId))))
        : -1;
      const block = { kind: 'guide', id, guide: moved };
      if (at >= 0) blocks.splice(at, 0, block); else blocks.push(block);
    }

    this.#renumberBlocks(blocks);
  }

  /** Delete a guide group; its guides move to the top level, last in the list. */
  deleteGuideGroup(id) {
    this.ensureArrays();
    const orphans = (this.data.guides || []).filter((g) => g.group === id);
    for (const g of orphans) delete g.group;
    const i = this.data.guide_groups.findIndex((g) => g.id === id);
    if (i >= 0) this.data.guide_groups.splice(i, 1);
    // Renumber so the freed guides sit at the end of the top level.
    const blocks = this.#navBlocks().filter((b) => !(b.kind === 'group' && b.id === id));
    const moved = orphans
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      .map((g) => ({ kind: 'guide', id: g.id, guide: g }));
    this.#renumberBlocks([...blocks.filter((b) => !(b.kind === 'guide' && orphans.some((o) => o.id === b.id))), ...moved]);
  }

  moveGuideGroup(id, beforeKey = null) {
    this.ensureArrays();
    const blocks = this.#navBlocks();
    const index = blocks.findIndex((b) => b.kind === 'group' && b.id === id);
    if (index < 0) return;
    const [moved] = blocks.splice(index, 1);
    const at = beforeKey ? blocks.findIndex((b) => `${b.kind}:${b.id}` === beforeKey) : -1;
    if (at >= 0) blocks.splice(at, 0, moved); else blocks.push(moved);
    this.#renumberBlocks(blocks);
  }

  addFolder() {
    this.ensureArrays();
    const id = this.genId('folder');
    this.data.folders.push({ id, name: 'New folder' });
    return id;
  }

  async addAttachmentFile(file) {
    this.ensureArrays();
    const id = this.genId('att');
    const original = file.name || 'file';
    const dot = original.lastIndexOf('.');
    const display = dot > 0 ? original.slice(0, dot) : original;
    const safe = original.replace(/[^\w.\-]+/g, '_');
    const path = `attachments/${id.replace(/^att_/, '')}_${safe}`;
    this.attachmentBlobs.set(id, file);
    this.attachmentUrls = { ...this.attachmentUrls, [id]: URL.createObjectURL(file) };
    this.data.attachments.push({ id, filename: display || safe, path, mime: file.type || '' });
    return id;
  }

  /** Add a tag to many files at once (bulk tagging from the Files view). */
  addTagToAttachments(ids, tag) {
    this.ensureArrays();
    const t = slugifyTag(tag);
    if (!t) return;
    for (const id of ids) {
      const a = this.data.attachments.find((x) => x.id === id);
      if (!a) continue;
      if (!Array.isArray(a.tags)) a.tags = [];
      if (!a.tags.includes(t)) a.tags.push(t);
    }
  }

  addLanguage(code) {
    this.ensureArrays();
    const lang = String(code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!lang) return null;
    if (!this.data.package.languages.includes(lang)) this.data.package.languages.push(lang);
    if (!this.data.package.default_language) this.data.package.default_language = lang;
    for (const guide of this.data.guides || []) {
      if (!guide.content) guide.content = {};
      if (!(lang in guide.content)) guide.content[lang] = '';
    }
    return lang;
  }

  deleteLanguage(lang) {
    this.ensureArrays();
    const languages = this.data.package.languages || [];
    if (languages.length <= 1) return false;
    const i = languages.indexOf(lang);
    if (i < 0) return false;
    languages.splice(i, 1);
    for (const guide of this.data.guides || []) if (guide.content) delete guide.content[lang];
    if (this.data.package.default_language === lang) this.data.package.default_language = languages[0] || 'en';
    return true;
  }

  addRole() {
    this.ensureArrays();
    let slug = 'role';
    const exists = (id) => collectRoleIds(this.data).includes(id);
    let i = 2;
    while (exists(slug)) slug = `role_${i++}`;
    this.data.roles.push({ id: slug, name: '' });
    return slug;
  }

  deleteRole(id) {
    this.ensureArrays();
    const i = this.data.roles.findIndex((r) => r.id === id);
    if (i >= 0) this.data.roles.splice(i, 1);
    for (const p of this.data.people || []) this.#rm(p.roles, id);
    for (const g of this.data.guides || []) this.#rm(g.audience_roles, id);
  }

  #rm(arr, id) {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === id) arr.splice(i, 1);
  }

  // Find an entity (any kind, incl. roles) + its display name, for clean deletes.
  #findEntity(id) {
    const map = { people: 'person', locations: 'location', items: 'item', guides: 'guide', folders: 'folder', attachments: 'attachment' };
    for (const k of KINDS) { const o = this.data[k]?.find((x) => x.id === id); if (o) return { obj: o, kind: map[k] }; }
    const r = this.data.roles?.find((x) => x.id === id);
    return r ? { obj: r, kind: 'role' } : null;
  }
  #nameOf(obj, kind) {
    if (kind === 'person') return obj.nickname || obj.name || obj.id;
    if (kind === 'attachment') return obj.filename || obj.id;
    if (kind === 'role') return obj.name || obj.id;
    return obj.name || obj.title || obj.id;
  }
  // Replace every [[id]] token in guide content with plain text, so a deleted
  // entity leaves a readable name behind instead of a dangling [[item_x]].
  #replaceRefTokens(id, name) {
    const re = new RegExp('\\[\\[' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\]', 'g');
    for (const g of this.data.guides || []) {
      if (!g.content) continue;
      for (const lang of Object.keys(g.content)) {
        if (typeof g.content[lang] === 'string') g.content[lang] = g.content[lang].replace(re, name);
      }
    }
  }

  deleteEntity(id) {
    if (!this.data) return;
    const found = this.#findEntity(id);
    if (found) this.#replaceRefTokens(id, this.#nameOf(found.obj, found.kind));
    if (found?.kind === 'role') {
      this.deleteRole(id);
      return;
    }
    for (const k of KINDS) {
      const arr = this.data[k]; if (!arr) continue;
      const i = arr.findIndex((o) => o.id === id);
      if (i >= 0) { arr.splice(i, 1); break; }
    }
    this.#scrubRefs(id);
  }

  /** Delete every reference to a deleted id so nothing dangles. */
  #scrubRefs(id) {
    const rm = (arr) => this.#rm(arr, id);
    for (const p of this.data.people || []) if (p.location_id === id) delete p.location_id;
    for (const l of this.data.locations || []) { if (l.parent_id === id) delete l.parent_id; rm(l.access_person_ids); rm(l.depends_on_ids); }
    for (const it of this.data.items || []) { rm(it.location_ids); rm(it.container_ids); rm(it.access_person_ids); rm(it.depends_on_ids); rm(it.guide_ids); rm(it.attachment_ids); }
    for (const g of this.data.guides || []) {
      rm(g.audience_person_ids);
      if (g.references) for (const key of Object.keys(g.references)) rm(g.references[key]);
      if (g.folder_id === id) delete g.folder_id;
    }
    for (const a of this.data.attachments || []) {
      if (a.item_id === id) delete a.item_id;
      if (a.guide_id === id) delete a.guide_id;
      rm(a.item_ids);
      rm(a.guide_ids);
    }
    if (this.data.package?.owner_id === id) delete this.data.package.owner_id;
    rm(this.data.package?.primary_person_ids);
  }
}
