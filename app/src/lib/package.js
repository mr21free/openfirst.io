/*
  Parse + resolve an inheritance package into a graph the UI can render.
  Pure functions, no I/O. Loading from disk/zip lives in load.js.
*/

export const DEFAULT_ROLES = [
  { id: 'owner', name: 'Owner' },
  { id: 'primary_heir', name: 'Primary heir' },
  { id: 'beneficiary', name: 'Beneficiary' },
  { id: 'professional', name: 'Professional' },
  { id: 'friend', name: 'Friend' }
];

export const ROLE_LABELS = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.name]));

export function humanizeKey(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A field that can be translated: `primary` is the default-language value (a
 * plain string, so legacy data keeps working) and `i18n` is an optional map of
 * per-language overrides. Returns the override for `lang` when present, else
 * the primary value.
 */
export function langValue(primary, i18n, lang) {
  return (lang && i18n && i18n[lang]) || primary || '';
}

/** Normalize a tag to a stable, token-safe slug: "Tax 2009" -> "tax-2009". */
export function slugifyTag(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function roleLabel(r, roles = null) {
  const found = roles?.find?.((role) => role.id === r);
  return found?.name || ROLE_LABELS[r] || humanizeKey(r);
}

export function collectRoleIds(data) {
  const ids = new Set(Array.isArray(data?.roles) ? [] : DEFAULT_ROLES.map((r) => r.id));
  for (const p of data?.people || []) for (const r of p.roles || []) ids.add(r);
  for (const g of data?.guides || []) for (const r of g.audience_roles || []) ids.add(r);
  for (const r of data?.roles || []) if (r?.id) ids.add(r.id);
  return [...ids];
}

export function normalizedRoles(data) {
  const byId = new Map();
  if (!Array.isArray(data?.roles)) for (const r of DEFAULT_ROLES) byId.set(r.id, { ...r });
  for (const r of data?.roles || []) {
    if (r?.id) byId.set(r.id, { id: r.id, name: r.name ?? roleLabel(r.id) });
  }
  for (const id of collectRoleIds(data)) {
    if (!byId.has(id)) byId.set(id, { id, name: humanizeKey(id) });
  }
  return [...byId.values()];
}

export const ITEM_TYPE_LABELS = {
  password_record: 'Password record',
  btc_seed: 'Bitcoin seed',
  btc_passphrase: 'Bitcoin passphrase',
  btc_wallet: 'Bitcoin wallet',
  hw_device: 'Hardware device',
  twofa: 'Two-factor (2FA)',
  secret_split_part: 'Split secret (part)',
  account_investment: 'Investment account',
  bank_account: 'Bank account',
  digital_service: 'Digital service / device',
  recovery_artifact: 'Recovery artifact',
  legal_document: 'Legal document',
  sim_card: 'SIM card',
  other: 'Other'
};

const IMP_ORDER = { high: 0, medium: 1, low: 2, undefined: 3 };

export class InheritancePackage {
  constructor(data, attachmentUrls = {}) {
    if (!data || data.schema !== 'inheritance-package/v1') {
      throw new Error('Not an inheritance package (expected schema "inheritance-package/v1").');
    }
    this.raw = data;
    this.meta = data.package || {};
    this.languages = this.meta.languages || ['en'];
    this.lang = this.meta.default_language || this.languages[0] || 'en';

    this.people = data.people || [];
    this.locations = data.locations || [];
    this.items = data.items || [];
    this.guides = data.guides || [];
    this.folders = data.folders || [];
    this.attachments = data.attachments || [];
    this.roles = normalizedRoles(data);

    // Indices
    this.byId = new Map();
    const index = (arr, kind) => arr.forEach((o) => this.byId.set(o.id, { kind, obj: o }));
    index(this.people, 'person');
    index(this.locations, 'location');
    index(this.items, 'item');
    index(this.guides, 'guide');
    index(this.folders, 'folder');
    index(this.attachments, 'attachment');
    index(this.roles, 'role');

    // Reverse dependency edges: who depends on this item.
    this.dependentsOf = new Map();
    for (const it of this.items) {
      for (const dep of it.depends_on_ids || []) {
        if (!this.dependentsOf.has(dep)) this.dependentsOf.set(dep, []);
        this.dependentsOf.get(dep).push(it.id);
      }
    }

    // Items located at / accessible by / stored inside a container item.
    // container_ids is the digital/logical counterpart of location_ids: "where
    // it is" can be a place OR another item (a password manager, a USB, a safe-
    // deposit envelope). itemsInContainer is the reverse — what a container holds.
    this.itemsAtLocation = new Map();
    this.itemsAccessibleBy = new Map();
    this.itemsInContainer = new Map();
    for (const it of this.items) {
      for (const loc of it.location_ids || []) push(this.itemsAtLocation, loc, it.id);
      for (const p of it.access_person_ids || []) push(this.itemsAccessibleBy, p, it.id);
      for (const c of it.container_ids || []) push(this.itemsInContainer, c, it.id);
    }

    // Which files an item carries (either link direction) — drives the list badge.
    this.attachmentsByItem = new Map();
    for (const a of this.attachments) {
      for (const iid of a.item_ids || []) push(this.attachmentsByItem, iid, a.id);
      if (a.item_id) push(this.attachmentsByItem, a.item_id, a.id);
    }
    for (const it of this.items) {
      for (const aid of it.attachment_ids || []) push(this.attachmentsByItem, it.id, aid);
    }

    // Attachment URLs (blob:/data:) keyed by attachment id, resolved from the loader.
    this.attachmentUrls = {};
    for (const att of this.attachments) {
      this.attachmentUrls[att.id] =
        attachmentUrls[att.id] || attachmentUrls[att.path] || attachmentUrls[normalize(att.path)] || null;
    }
  }

  get owner() {
    if (this.meta.owner_id && this.byId.has(this.meta.owner_id)) return this.byId.get(this.meta.owner_id).obj;
    return this.people.find((p) => (p.roles || []).includes('owner')) || null;
  }

  entity(id) { return this.byId.get(id) || null; }

  /** Display name: a person's nickname (if any), else legal name / title.
   *  When the name is not yet set, returns a numbered fallback so multiple
   *  unnamed objects of the same kind are still distinguishable in lists. */
  name(id) {
    const e = this.byId.get(id);
    if (!e) return id;
    const o = e.obj;
    if (e.kind === 'person') {
      if (o.nickname || o.name) return o.nickname || o.name;
      return this.#nthEmpty(this.people, (p) => p.nickname || p.name, o, 'New Person');
    }
    if (e.kind === 'attachment') return o.filename || 'New File';
    if (e.kind === 'role') {
      if (o.name) return o.name;
      return this.#nthEmpty(this.roles, (r) => r.name, o, 'New Role');
    }
    if (e.kind === 'guide') {
      if (o.title) return langValue(o.title, o.title_i18n, this.lang);
      return this.#nthEmpty(this.guides, (g) => g.title, o, 'New Guide');
    }
    if (e.kind === 'location') {
      if (o.name) return o.name;
      return this.#nthEmpty(this.locations, (l) => l.name, o, 'New Location');
    }
    if (e.kind === 'item') {
      if (o.name) return o.name;
      return this.#nthEmpty(this.items, (it) => it.name, o, 'New Item');
    }
    return o.name || o.title || 'Unnamed';
  }

  /** Return "Base", "Base (1)", "Base (2)" based on position among unnamed objects. */
  #nthEmpty(arr, getKey, obj, base) {
    const empties = arr.filter((x) => !getKey(x));
    const i = empties.indexOf(obj);
    return i <= 0 ? base : `${base} (${i})`;
  }

  /** All the names an entity can be referred to by (for cross-link matching). */
  aliases(id) {
    const e = this.byId.get(id);
    if (!e) return [];
    const o = e.obj;
    return [o.name, o.nickname, o.title, o.filename, o.id].filter(Boolean);
  }

  /** A short, human file type for an attachment — "PDF", "JPG image", "File". */
  fileType(id) {
    const o = this.byId.get(id)?.obj;
    if (!o) return 'File';
    const name = o.filename || o.path || '';
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mime = (o.mime || '').toLowerCase();
    if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
    if (mime.startsWith('image/') || /^(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?)$/.test(ext)) {
      const t = (mime.split('/')[1] || ext).toUpperCase().replace(/^JPEG$/, 'JPG').replace(/\+XML$/, '');
      return t ? `${t} image` : 'Image';
    }
    if (ext && ext.length <= 5) return ext.toUpperCase();
    return 'File';
  }

  text(localized) {
    if (!localized) return '';
    return localized[this.lang] || localized[this.languages[0]] || Object.values(localized)[0] || '';
  }

  /** Sort by importance HIGH → LOW, then the author's explicit `order`, then name. */
  ordered(arr) {
    return [...arr].sort(cmpOrder);
  }

  /** Sort entity ids with the same priority rules used for full entity arrays. */
  orderedIds(ids) {
    const indexed = ids.map((id, index) => ({ id, index, entity: this.entity(id)?.obj || null }));
    return indexed
      .sort((a, b) => {
        if (a.entity && b.entity) return cmpOrder(a.entity, b.entity);
        if (a.entity) return -1;
        if (b.entity) return 1;
        return a.index - b.index;
      })
      .map((x) => x.id);
  }

  /** People with a non-owner role — candidates for "who are you?". */
  audiences() {
    return this.ordered(this.people.filter((p) => (p.roles || []).some((r) => r !== 'owner')));
  }

  /** Ids of the plan's primary recipients (the people it's mainly for), in set order. */
  primaryRecipientIds() {
    return (this.meta.primary_person_ids || []).filter((id) => this.byId.has(id));
  }

  peopleOrdered() { return this.ordered(this.people); }
  itemsOrdered() { return this.ordered(this.items); }
  itemsByImportance() { return this.itemsOrdered(); } // back-compat alias

  /** Guides ordered for reading, optionally filtered to an audience person. */
  guidesFor(personId = null) {
    const person = personId ? this.byId.get(personId)?.obj : null;
    const roles = person ? person.roles || [] : null;

    const visible = this.guides.filter((g) => {
      if (!person) return true;
      const okPerson = (g.audience_person_ids || []).includes(personId);
      const okRole = (g.audience_roles || []).some((r) => roles.includes(r));
      const noAudience = !(g.audience_person_ids?.length || g.audience_roles?.length);
      return okPerson || okRole || noAudience;
    });

    return visible.sort(cmpOrder);
  }

  /** Ordered nav group definitions: explicit ones first, then any implied by a guide.group. */
  guideGroups() {
    const defs = (this.raw.guide_groups || []).map((g) => ({
      id: g.id,
      name: g.name || humanizeKey(g.id),
      order: g.order,
      raw: g
    }));
    const known = new Set(defs.map((d) => d.id));
    for (const g of this.guides) {
      if (g.group && !known.has(g.group)) { known.add(g.group); defs.push({ id: g.group, name: humanizeKey(g.group) }); }
    }
    return defs;
  }

  roleLabel(id) { return roleLabel(id, this.roles); }

  roleOptions() { return this.roles.map((r) => ({ value: r.id, label: r.name || roleLabel(r.id, this.roles) })); }

  attachmentsOrdered() { return this.ordered(this.attachments); }

  /** Every distinct file tag, sorted — for filters and autocomplete. */
  allTags() {
    const set = new Set();
    for (const a of this.attachments || []) for (const t of a.tags || []) set.add(t);
    return [...set].sort();
  }
  /** Attachments carrying a given tag. */
  attachmentsWithTag(tag) {
    return (this.attachments || []).filter((a) => (a.tags || []).includes(tag));
  }

  // --- Location nesting (arbitrary depth via parent_id) ---
  locationBranchRank(id, seen = new Set()) {
    if (seen.has(id)) return 3;
    seen.add(id);
    const loc = this.byId.get(id)?.obj;
    if (!loc) return 3;

    let rank = IMP_ORDER[loc.importance] ?? 3;
    for (const child of this.locations.filter((l) => l.parent_id === id)) {
      rank = Math.min(rank, this.locationBranchRank(child.id, new Set(seen)));
    }
    return rank;
  }

  /** Locations use manual order (drag-and-drop), then name — never importance. */
  orderedLocationBranches(locations) {
    return [...locations].sort((a, b) =>
      (a.order ?? Infinity) - (b.order ?? Infinity) ||
      (a.name || '').localeCompare(b.name || '')
    );
  }

  locationRoots() {
    return this.orderedLocationBranches(this.locations.filter((l) => !l.parent_id || !this.byId.has(l.parent_id)));
  }
  locationChildren(id) {
    return this.orderedLocationBranches(this.locations.filter((l) => l.parent_id === id));
  }
  /** Flattened tree: [{ loc, depth }] in display order. */
  locationTreeFlat() {
    const out = [];
    const walk = (node, depth) => {
      out.push({ loc: node, depth });
      for (const c of this.locationChildren(node.id)) walk(c, depth + 1);
    };
    for (const r of this.locationRoots()) walk(r, 0);
    return out;
  }
  /** Ancestor chain (root first) for a breadcrumb. */
  locationPath(id) {
    const path = [];
    const seen = new Set([id]);
    let cur = this.byId.get(id)?.obj;
    while (cur?.parent_id && this.byId.has(cur.parent_id) && !seen.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      cur = this.byId.get(cur.parent_id).obj;
      path.unshift(cur);
    }
    return path;
  }
}

// Priority first: importance HIGH → LOW (top to bottom), then the author's
// explicit `order`, then name. So a list with priorities reads high-to-low.
function cmpOrder(a, b) {
  const ia = IMP_ORDER[a.importance] ?? 3;
  const ib = IMP_ORDER[b.importance] ?? 3;
  if (ia !== ib) return ia - ib;
  const oa = a.order ?? Infinity;
  const ob = b.order ?? Infinity;
  if (oa !== ob) return oa - ob;
  return (a.name || a.title || a.filename || '').localeCompare(b.name || b.title || b.filename || '');
}

function push(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}

function normalize(p) {
  return (p || '').replace(/^\.?\//, '');
}
