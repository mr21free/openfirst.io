# Package schema — `lifepackage/v1`

A plan is a single JSON object. It's an **open, durable format** (plain JSON +
Markdown) designed to stay readable for many years without the app. The formal
contract is [`lifepackage.schema.json`](./lifepackage.schema.json);
this page is the friendly version.

Legacy packages that use `schema: "inheritance-package/v1"` and the filename
`inheritance.json` still open in OpenFirst. New exports use `schema:
"lifepackage/v1"` and `lifepackage.json`.

**Core idea:** the plan is a *map of where things live and who gets them* — not a
vault for raw secrets. Describe where a secret is and how to find it; don't paste
the secret.

## Top level

```json
{
  "schema": "lifepackage/v1",
  "package":      { ... },
  "roles":        [ ... ],
  "people":       [ ... ],
  "locations":    [ ... ],
  "items":        [ ... ],
  "guide_groups": [ ... ],
  "guides":       [ ... ],
  "attachments":  [ ... ]
}
```

**IDs** are arbitrary strings, **unique within their array**, and referenced by
id elsewhere. Every reference must resolve to an entity that exists.

## `package`
| field | req | meaning |
|---|---|---|
| `id` | ✓ | stable unique id for the plan |
| `title` | ✓ | e.g. "Inheritance plan of Jane Doe" |
| `owner_id` |  | a `people` id — the plan's owner |
| `created`, `updated` |  | ISO dates `YYYY-MM-DD` |
| `languages` | ✓ | e.g. `["en","sk"]` |
| `default_language` | ✓ | one of `languages` |

## `roles[]`
`{ id, name }` — e.g. `{ "id": "primary_heir", "name": "Primary heir" }`. If you
omit `roles`, defaults (owner, primary_heir, beneficiary, professional, friend)
are added automatically.

## `people[]`
| field | req | meaning |
|---|---|---|
| `id`, `name` | ✓ | |
| `nickname` |  | |
| `roles` |  | array of `roles` ids |
| `importance` |  | `high` \| `medium` \| `low` |
| `notes` |  | |
| `sensitive` |  | boolean |
| `access_path` |  | `{ steps: [{ id, text, ref_id?, photo_id? }] }` — the person's physical journey to the plan ("open the safe", "take the envelope"). Their first screen in the reader; printable envelope insert. Pointers only, never secrets. `ref_id` = a location/item id, `photo_id` = an attachment id. |

## `locations[]` — a tree
Nest places with `parent_id` (Country → City → Home → Safe).
| field | req | meaning |
|---|---|---|
| `id`, `name` | ✓ | |
| `parent_id` |  | parent location id (omit for top level) |
| `order` |  | sort among siblings |
| `notes` |  | |
| `access_person_ids` |  | people who can physically reach it |
| `importance` |  | high/medium/low |

## `items[]` — the things
Accounts, wallets, keys, documents, devices, assets.
| field | req | meaning |
|---|---|---|
| `id`, `name` | ✓ | |
| `description`, `notes` |  | |
| `price` |  | optional value, e.g. "45 EUR / year" |
| `importance` |  | high/medium/low |
| `location_ids` |  | where it lives (≥1 = redundant copies) |
| `container_ids` |  | container **item** ids it's stored inside (e.g. a PIN inside a password manager) — digital counterpart of `location_ids` |
| `access_person_ids` |  | who can access it |
| `depends_on_ids` |  | other item ids it needs (e.g. a PIN item) |
| `attachment_ids` |  | files documenting it |
| `guide_ids` |  | guides explaining it |
| `sensitive` |  | boolean |

## `guide_groups[]`
`{ id, name, order?, name_i18n? }` — folders for guides in the nav. `name_i18n`
holds per-language name overrides, e.g. `{ "sk": "Všeobecné" }`.

## `guides[]` — the human instructions
| field | req | meaning |
|---|---|---|
| `id`, `title` | ✓ | `title` is the default-language title |
| `title_i18n` |  | per-language title overrides `{ "sk": "..." }` |
| `group` |  | a `guide_groups` id (omit for top level) |
| `order` |  | sort order |
| `draft` |  | if `true`, kept in the plan but **excluded from the heir reader** |
| `importance` |  | high/medium/low |
| `content` | ✓ | Markdown body per language: `{ "en": "## ...", "sk": "## ..." }` |
| `references` |  | entities mentioned (see below) |
| `audience_roles` |  | role ids this guide is for (empty = everyone) |
| `audience_person_ids` |  | specific people it's for |

**Inside `content` (Markdown):**
- Cross-link any entity with `[[id]]` — e.g. `…the will is at [[loc_home]]`. List
  the ids you use under that guide's `references`.
- Link a group of files with `[#label](#tag:slug)` — clicking it opens Files
  filtered to that tag.

`references` shape: `{ person_ids?, role_ids?, item_ids?, location_ids?,
guide_ids?, attachment_ids? }`.

## `attachments[]` — files
Usually left empty by an AI; you add real files in the app.
`{ id, filename, path?, mime?, description?, tags? }`. `tags` are lowercase slugs
for grouping/search, e.g. `["tax","2009"]`.

---

A complete, realistic example lives in the repo at
[`app/src/sample/lifepackage.json`](../app/src/sample/lifepackage.json) (the same
data behind the in-app **Demo**).
