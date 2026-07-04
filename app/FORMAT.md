# Life Package Format - v1

`schema: "lifepackage/v1"`

This document describes the open, durable format used by openfirst.io. The
goals are simple: **human-readable**, **machine-readable**, and **still openable
in 10+ years** with no server, account, or proprietary runtime. The authoritative
contract is [schema/lifepackage.schema.json](./schema/lifepackage.schema.json);
this file is the friendly explanation.

## Package Shapes

The source of truth is always `lifepackage.json`. A package may be:

- a single `lifepackage.json` file,
- a folder containing `lifepackage.json`, `manifest.json`, `START_HERE.txt`, and
  optional `attachments/`,
- a `.zip` of that folder,
- or an encrypted JSON envelope whose plaintext is the package `.zip`.

Legacy packages named `inheritance.json` with `schema:
"inheritance-package/v1"` still open in OpenFirst. When you re-export them, the
new package uses `lifepackage.json` and `schema: "lifepackage/v1"`.

## Updating Old Packages

Old packages do not need to be changed to open in OpenFirst. To make one use the
new canonical format:

1. Rename `inheritance.json` to `lifepackage.json`.
2. In that JSON file, change the top-level `"schema"` from
   `"inheritance-package/v1"` to `"lifepackage/v1"`.
3. If the package has `manifest.json`, change `schema` to `"lifepackage/v1"` and
   `files.source` to `"lifepackage.json"`.
4. If the package is zipped, re-create the `.zip` after the rename.
5. If the package is encrypted, open it with the old password and export it
   again. Do not hand-edit the encrypted envelope.

Typical folder layout:

```text
LifePackage_YYYY-MM-DD/
  START_HERE.txt
  manifest.json
  lifepackage.json
  attachments/
```

Attachments are real files referenced by relative path. They are not base64
encoded into the JSON.

## Data Model

The package is a property graph: people, roles, locations, items, guides, guide
groups, attachments, and owner-only readiness checks are connected by stable id
references. The default posture is a **map of where things are**, not a vault of
raw secrets.

### `package`

Metadata for the plan:

`id`, `title`, `owner_id`, `created`, `updated`, `languages[]`,
`default_language`, `primary_person_ids[]`, `map_audience_roles[]`,
`map_audience_person_ids[]`, and optional `notes`.

`owner_id` points to the single person who owns/prepared the plan. Map audience
fields control who can see the Map in read mode. Empty or missing map audience
fields mean the map is visible to everyone.

### `roles[]`

Editable user-facing roles:

`id`, `name`.

People and guide audiences reference roles by id. Older built-in role ids such
as `owner`, `primary_heir`, `beneficiary`, `professional`, and `friend` are just
normal role ids in the current model.

### `people[]`

Simple person records:

`id`, `name`, `nickname`, `display_as`, `roles[]`, `readiness_score`,
`contacts[]`, `verification{question, answer_hint}`, `access_path`,
`importance`, and `notes`.

`access_path` is the person's physical journey to the plan — their first
screen in the reader, and printable as the envelope insert:

```json
{ "access_path": { "steps": [
  { "id": "st_1", "text": "Open the home safe — the PIN is with your mother.",
    "ref_id": "loc_home_safe", "photo_id": "att_safe_photo" }
] } }
```

Each step's `text` is required in practice; `ref_id` (a location or item) and
`photo_id` (an attachment) are optional. Pointers only — never a secret.

People do not carry language, country, based-at location, role boundaries, or
manual order in the current product.

### `locations[]`

Places or containers in a visual hierarchy:

`id`, `name`, `parent_id`, `access_person_ids[]`, `depends_on_ids[]`, `order`,
and `notes`.

Locations do not have a fixed type. A country, city, home, cabinet, safe, or
cloud account can all be represented as locations; the human-readable name tells
the reader what it is. Nesting is done with `parent_id`, and manual ordering is
done with `order`.

### `items[]`

Assets, accounts, devices, documents, services, credentials, or anything else
that matters:

`id`, `name`, `importance`, `description`, `notes`, `price`, `location_ids[]`,
`container_ids[]`, `access_person_ids[]`, `depends_on_ids[]`, `guide_ids[]`,
`attachment_ids[]`, and `sensitive`.

`sensitive: true` is a handle-with-care badge only — it marks an item whose
real-world counterpart is a secret (a seed, PIN, password). The item itself
must still only *describe where the secret lives*, never hold its value.

`depends_on_ids[]` is intentionally general: it can represent keys, codes,
devices, accounts, documents, or other prerequisites needed to access/use an
item or location.

### `guides[]`

Human-readable instructions:

`id`, `title`, `group`, `order`, `importance`, `draft`, `audience_roles[]`,
`audience_person_ids[]`, `content`, and
`references{person_ids,item_ids,location_ids,guide_ids}`.

All guides are the same type. There are no print-only, envelope, or label guide
types. `content` is Markdown keyed by language code, for example:

```json
{ "en": "## Start here\n\nRead this first.", "sk": "## Zacnite tu\n\n..." }
```

The guide content supports entity references such as `[[item_trezor]]`, file
mentions such as `@file-name`, inline images such as `@img:file-name`, and MP4
video embeds such as `@video:file-name`.

### `guide_groups[]`

Manual guide menu groups:

`id`, `name`, `order`.

Guides join a group by storing the group id in `guide.group`.

### `attachments[]`

Files shipped with the package:

`id`, `filename`, `original_filename`, `path`, `mime`, `description`,
`item_id`, and `guide_id`.

The displayed `filename` may omit the extension for readability. The exported
file on disk keeps the extension in `path`.

### `readiness_checks[]`

Owner-side checks that prove the plan can actually be used:

`id`, `title`, `importance`, `scope`, `question`, `expected`, `owner_notes`,
`tags[]`, `person_ids[]`, `role_ids[]`, and related entity ids.

`scope: "external"` checks are visible during a dry run with the intended
person. `scope: "internal"` checks are private owner todos/gaps and are hidden
during the dry run.

### `readiness_runs[]`

Recorded dry-run outcomes:

`id`, `person_id`, `date`, `started_at`, `submitted_at`, `duration_ms`, and
`results[]`, where each result stores `check_id`, `status`, and `notes`.

Readiness checks and dry-run notes are owner data. They are kept in the working
package/exported source, but removed from the final read-only `start-here.html`
heir reader.

## Secrets

The package never stores raw secrets. It points to where secrets live and how
they relate — a **map, not a vault**. Seeds, passphrases, PINs, and passwords
stay outside the package (hardware, paper, a password manager), and items
describe how to find them.

Earlier drafts of this format allowed an optional `item.secret` object. It is
removed: readers must ignore it, and importers should strip it so a forgotten
secret can never ride along invisibly into a new export.

## Languages

`package.languages` lists supported languages and `package.default_language`
defines fallback. Guide `content` is keyed by language code. When a translation
is missing, the reader falls back to the default language and shows a fallback
notice.

Removing a language removes all guide translations for that language.

## Optional Password Encryption

For people who will not keep the package on encrypted hardware, the package
`.zip` can be locked with a password in a self-describing JSON envelope:

```json
{
  "format": "lifepackage-encrypted/v1",
  "cipher": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "iterations": 600000,
  "salt": "<base64, 16 bytes>",
  "iv": "<base64, 12 bytes>",
  "ciphertext": "<base64>",
  "content": "package-zip",
  "aad": "v1",
  "hint": "optional password hint"
}
```

The app decrypts on the device. The password is never sent anywhere. Because
every parameter is stored in the envelope, the package can be decrypted without
this app using standard Web Crypto or Node.js primitives.

**Tamper-proof metadata (`aad: "v1"`).** The plaintext fields a reader shows
before decryption — most importantly the `hint` — are bound to the ciphertext
as AES-GCM *additional authenticated data*, so nobody can rewrite the hint on
an encrypted file (say, into a phishing instruction) without breaking
decryption. To decrypt an `aad: "v1"` envelope, pass this UTF-8 string as the
GCM `additionalData`:

```text
lifepackage-aad/v1\n<format>\n<content>\n<hint or empty string>
```

Envelopes without the `aad` field decrypt the classic way (no additionalData).
Legacy encrypted envelopes with `format: "inheritance-encrypted/v1"` are also
accepted.

## Durability Rules

1. Keep the source open: JSON plus ordinary files.
2. Keep ids stable once created.
3. Keep attachments as files referenced by path.
4. Prefer pointers over raw secrets.
5. Version the `schema` field so future readers can migrate safely.
