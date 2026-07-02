You are helping me build an inheritance / "in case I die" plan as a single JSON
file in the format "inheritance-package/v1". The plan is a map of where things
live, who can access them, and what guidance each person should see. It is NOT a
store of raw secrets.

Follow these rules exactly:

1. Output one JSON object and nothing else (no prose, no markdown fences) when I
   ask for the final file. Until then, interview me.
2. Conform to the schema summarized below. Unknown/extra fields are allowed, but
   prefer the documented ones.
3. IDs are arbitrary strings but must be unique within their array and
   referenced consistently. Use readable ids like "person_jane", "loc_home",
   "item_trezor", "role_primary_heir", "guide_first_steps".
4. Every reference must resolve: ids in owner_id, map_audience_roles,
   map_audience_person_ids, roles, parent_id, location_ids, container_ids,
   access_person_ids, depends_on_ids, attachment_ids, guide_ids,
   audience_roles, audience_person_ids, group, and references.* must point to an
   entity that exists in the file.
5. Never invent or include real secrets (PINs, seeds, passwords, keys, account
   numbers). If a value is sensitive, describe where/how to find it instead, and
   set "sensitive": true on that item.
6. Write guides as clear, calm Markdown for a non-technical reader. Inside guide
   content you may cross-link entities with [[id]] tokens and list those ids in
   that guide's references.
7. You may mention file groups with [#tag](#tag:slug). Inline media is supported
   with [[img:attachment_id]] for images and [[video:attachment_id]] for MP4
   videos, but leave attachments empty unless I explicitly give you existing
   file metadata. I will add real files in the app.
8. Do not create country/type fields for locations. A location can be a country,
   city, home, safe, bank box, etc. Put that meaning in the name and hierarchy.
9. Keep the plan practical and sparse. Prefer notes and relationships over
   invented categories.

SCHEMA SUMMARY
- Top level: { "schema": "inheritance-package/v1", "package": {...}, "people":
  [...], "roles": [...], "locations": [...], "items": [...], "guide_groups":
  [...], "guides": [...], "attachments": [] }
- package: { id, title, owner_id (a people id), created (YYYY-MM-DD), updated,
  languages: ["en"], default_language: "en", map_audience_roles?: [roleId],
  map_audience_person_ids?: [personId] }
  If map_audience_roles and map_audience_person_ids are both empty or missing,
  the map is visible to everyone who can open the plan.
- roles[]: { id, name }
  Examples: owner, primary_heir, beneficiary, professional, friend.
- people[]: { id, name, nickname?, roles: [roleId],
  importance?: high|medium|low, notes?, sensitive?: bool }
- locations[]: { id, name, parent_id?, order?, notes?, access_person_ids?,
  depends_on_ids? }
  Nest with parent_id, for example: Country > City > Home > Safe. Use order only
  for manual ordering among siblings.
- items[]: { id, name, description?, notes?, price?, importance?,
  location_ids?, container_ids?, access_person_ids?, depends_on_ids?,
  attachment_ids?, guide_ids?, sensitive? }
  container_ids are item ids this item is stored inside, for example a recovery
  code inside a password manager. depends_on_ids are item ids needed to access
  or use this item.
- attachments[]: { id, filename, original_filename?, mime?, description?,
  tags?, item_ids?, guide_ids? }
  Usually leave attachments empty; real files should be added locally in the app.
- guide_groups[]: { id, name, order? }
- guides[]: { id, title, group?, order?, importance?, draft?: bool,
  content: { "en": "## ...markdown..." },
  references?: { person_ids?, role_ids?, item_ids?, location_ids?, guide_ids?,
  attachment_ids? },
  audience_roles?: [roleId], audience_person_ids?: [personId] }

MINIMAL VALID EXAMPLE (shape only):
{
  "schema": "inheritance-package/v1",
  "package": {
    "id": "plan-1",
    "title": "My inheritance plan",
    "owner_id": "person_me",
    "created": "2026-01-01",
    "updated": "2026-01-01",
    "languages": ["en"],
    "default_language": "en",
    "map_audience_roles": ["primary_heir"]
  },
  "roles": [
    { "id": "owner", "name": "Owner" },
    { "id": "primary_heir", "name": "Primary heir" }
  ],
  "people": [
    { "id": "person_me", "name": "Me", "roles": ["owner"] },
    { "id": "person_spouse", "name": "Jane", "roles": ["primary_heir"] }
  ],
  "locations": [
    { "id": "loc_country", "name": "Country X", "order": 0 },
    { "id": "loc_home", "name": "Home safe", "parent_id": "loc_country", "order": 0 }
  ],
  "items": [
    {
      "id": "item_will",
      "name": "Will (original)",
      "importance": "high",
      "location_ids": ["loc_home"],
      "access_person_ids": ["person_spouse"]
    }
  ],
  "guide_groups": [
    { "id": "general", "name": "General", "order": 0 }
  ],
  "guides": [
    {
      "id": "guide_first",
      "title": "First steps",
      "group": "general",
      "order": 0,
      "audience_roles": ["primary_heir"],
      "content": {
        "en": "## First steps\n\nTake your time. The will is at [[loc_home]]; [[person_spouse]] can open it."
      },
      "references": {
        "location_ids": ["loc_home"],
        "person_ids": ["person_spouse"]
      }
    }
  ],
  "attachments": []
}

Now interview me: ask short, grouped questions about my people and their roles,
the places I keep things, the items (accounts, wallets, keys, documents,
devices), who can access what, and what guidance each heir needs. Ask only for
non-sensitive structure. When I say "generate", validate that every reference
resolves and every id is unique, then output the final JSON only.
