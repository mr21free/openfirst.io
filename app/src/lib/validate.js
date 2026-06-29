/*
  Validate an inheritance-package/v1 object before loading it: schema, required
  fields, unique ids, and that every cross-reference resolves. Returns a list of
  human-readable problems ([] = valid). Used on import so an AI-built or
  hand-edited plan fails loudly with actionable messages instead of loading
  half-broken. Roles and guide groups are intentionally lenient — the app
  supplies defaults / creates implied groups.
*/

export function validatePackage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['The file is not a plan object.'];
  }
  const errors = [];
  if (data.schema && data.schema !== 'inheritance-package/v1') {
    errors.push(`Unknown schema "${data.schema}" (expected "inheritance-package/v1").`);
  }
  if (!data.package || typeof data.package !== 'object') errors.push('Missing "package" section.');

  const KINDS = ['people', 'roles', 'locations', 'items', 'guides', 'guide_groups', 'attachments', 'folders'];
  const idSets = {};
  for (const k of KINDS) {
    const arr = data[k];
    idSets[k] = new Set();
    if (arr == null) continue;
    if (!Array.isArray(arr)) { errors.push(`"${k}" must be a list.`); continue; }
    arr.forEach((o, i) => {
      if (!o || typeof o !== 'object') { errors.push(`${k}[${i}] is not an object.`); return; }
      if (!o.id) { errors.push(`${k}[${i}] is missing "id".`); return; }
      if (idSets[k].has(o.id)) errors.push(`Duplicate id "${o.id}" in ${k}.`);
      idSets[k].add(o.id);
    });
  }

  for (const p of data.people || []) if (p.id && !p.name) errors.push(`Person "${p.id}" is missing "name".`);
  for (const l of data.locations || []) if (l.id && !l.name) errors.push(`Location "${l.id}" is missing "name".`);
  for (const it of data.items || []) if (it.id && !it.name) errors.push(`Item "${it.id}" is missing "name".`);
  for (const g of data.guides || []) {
    if (g.id && !g.title) errors.push(`Guide "${g.id}" is missing "title".`);
    if (g.id && (!g.content || typeof g.content !== 'object')) errors.push(`Guide "${g.id}" is missing "content".`);
  }

  const has = (kind, id) => idSets[kind]?.has(id);
  const ref = (where, kind, ids) => {
    for (const id of ids || []) if (!has(kind, id)) errors.push(`${where} references a missing ${kind.replace(/s$/, '')}: "${id}".`);
  };

  if (data.package?.owner_id && !has('people', data.package.owner_id)) {
    errors.push(`package.owner_id "${data.package.owner_id}" is not a known person.`);
  }
  ref('package.primary_person_ids', 'people', data.package?.primary_person_ids);
  for (const l of data.locations || []) {
    if (l.parent_id && !has('locations', l.parent_id)) errors.push(`Location "${l.id}" parent_id "${l.parent_id}" is not a known location.`);
    ref(`Location "${l.id}"`, 'people', l.access_person_ids);
  }
  for (const it of data.items || []) {
    ref(`Item "${it.id}"`, 'locations', it.location_ids);
    ref(`Item "${it.id}"`, 'people', it.access_person_ids);
    ref(`Item "${it.id}"`, 'items', it.depends_on_ids);
    ref(`Item "${it.id}"`, 'attachments', it.attachment_ids);
    ref(`Item "${it.id}"`, 'guides', it.guide_ids);
  }
  for (const g of data.guides || []) {
    ref(`Guide "${g.id}"`, 'people', g.audience_person_ids);
    const r = g.references || {};
    ref(`Guide "${g.id}"`, 'people', r.person_ids);
    ref(`Guide "${g.id}"`, 'items', r.item_ids);
    ref(`Guide "${g.id}"`, 'locations', r.location_ids);
    ref(`Guide "${g.id}"`, 'guides', r.guide_ids);
    ref(`Guide "${g.id}"`, 'attachments', r.attachment_ids);
  }
  return errors;
}
