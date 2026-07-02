# Inheritance Package Format - v1

`schema: "inheritance-package/v1"`

This document describes the open, durable format used by lifepackage.io. The
goals are simple: **human-readable**, **machine-readable**, and **still openable
in 10+ years** with no server, account, or proprietary runtime. The authoritative
contract is [schema/inheritance.schema.json](./schema/inheritance.schema.json);
this file is the friendly explanation.

## Package Shapes

The source of truth is always `inheritance.json`. A package may be:

- a single `inheritance.json` file,
- a folder containing `inheritance.json`, `manifest.json`, `START_HERE.txt`, and
  optional `attachments/`,
- a `.zip` of that folder,
- or an encrypted JSON envelope whose plaintext is the package `.zip`.

Typical folder layout:

```text
InheritancePackage_YYYY-MM-DD/
  START_HERE.txt
  manifest.json
  inheritance.json
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
`contacts[]`, `verification{question, answer_hint}`, `importance`, and `notes`.

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
`attachment_ids[]`, `sensitive`, and optional `secret`.

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

By default the package points to where secrets live and how they relate. A raw
secret is stored only when an item is explicitly marked `sensitive: true` and
carries:

```json
{ "secret": { "kind": "password", "value": "...", "note": "optional" } }
```

Apps must treat `sensitive` items visibly and carefully.

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
  "format": "inheritance-encrypted/v1",
  "cipher": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "iterations": 600000,
  "salt": "<base64, 16 bytes>",
  "iv": "<base64, 12 bytes>",
  "ciphertext": "<base64>",
  "content": "package-zip",
  "hint": "optional password hint"
}
```

The app decrypts on the device. The password is never sent anywhere. Because
every parameter is stored in the envelope, the package can be decrypted without
this app using standard Web Crypto or Node.js primitives.

## Durability Rules

1. Keep the source open: JSON plus ordinary files.
2. Keep ids stable once created.
3. Keep attachments as files referenced by path.
4. Prefer pointers over raw secrets.
5. Version the `schema` field so future readers can migrate safely.
