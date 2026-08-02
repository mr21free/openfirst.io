# Life Package Format - v1

`schema: "lifepackage/v1"`

This document describes the open, durable format used by openfirst.io. The
goals are simple: **human-readable**, **machine-readable**, and **still openable
in 10+ years** with no server, account, or proprietary runtime. The authoritative
contract is [schema/lifepackage.schema.json](./schema/lifepackage.schema.json);
this file is the friendly explanation.

## The Plan File (.html) — Container Format v1

The canonical artifact is a single `.html` file: the thing you double-click to
read, the thing an heir opens, and the thing the app saves into while you
edit. Everything below is the *container* — how that one file is put
together. The data model it carries inside (people, items, guides, and so on)
is the unchanged `lifepackage/v1` schema described later in this document.

A plan file has three parts, in this order in the document:

1. **A static front door.** Plain HTML, present in the markup itself (not
   drawn by JavaScript), so it's readable in the raw file — view source, or
   open it in a text editor — even in 10+ years, or if the embedded app fails
   to parse in some future browser. It's hidden from the rendered page by
   default (the app removes it once it boots, and it never gets a chance to
   paint) so it doesn't flash before the real content loads. It shows: the
   app name and container format version, the plan id, the revision number
   and a human-readable "last saved" timestamp (informational only — see
   Revision, below), and, if the plan is passphrase-protected, the label and
   hint for every passphrase slot ("Sarah — hint: our anniversary"), so a
   reader knows whose passphrase to try without ever seeing the plan's
   content.
2. **A data island.** One `<script type="application/json">` tag holding the
   container JSON described below.
3. **The embedded app bundle** — the same self-contained build the app
   already produces, which reads the data island and renders the interactive
   read-only viewer (or, when opened through the app itself, the editor).

### Container JSON shape

```json
{
  "format": "lifepackage-plan/v1",
  "formatVersion": 1,
  "planId": "plan_8f2c1a90",
  "revision": 7,
  "updated": "2026-07-27T14:32:00Z",
  "protection": "none",
  "title": "Miro Family Plan",
  "data": { "schema": "lifepackage/v1", "...": "the plan, as normal JSON" }
}
```

or, passphrase-protected:

```json
{
  "format": "lifepackage-plan/v1",
  "formatVersion": 1,
  "planId": "plan_8f2c1a90",
  "revision": 7,
  "updated": "2026-07-27T14:32:00Z",
  "protection": "passphrase",
  "kdf": "PBKDF2-SHA256",
  "cipher": "AES-256-GCM",
  "title": "Miro Family Plan",
  "slots": [
    {
      "id": "slot_a1",
      "label": "Sarah",
      "hint": "our anniversary",
      "iterations": 600000,
      "salt": "<base64, 16 bytes>",
      "iv": "<base64, 12 bytes>",
      "wrappedKey": "<base64>"
    }
  ],
  "iv": "<base64, 12 bytes>",
  "data": "<base64 ciphertext>"
}
```

Field notes:

- **`planId` / `revision` / `title` are always plaintext**, protected or not.
  `planId` and `revision` exist so the app can compare "is the file caught up
  with my edits?" as a plain integer comparison — never by trusting clocks —
  and so several plans can be told apart without decrypting anything. `title`
  is plaintext for the same reason: it isn't a secret (the file name usually
  already reveals it anyway), and hiding it would only get in the way of
  labeling a saved-but-locked plan in a list. `updated` is a courtesy
  timestamp for humans; nothing in the app's logic depends on it.
- **One random master key encrypts `data`.** It is never derived from a
  passphrase directly. Instead, each entry in `slots[]` is that same master
  key, re-encrypted ("wrapped") under a key derived from one person's own
  passphrase. Removing a person means deleting their slot; nobody else's slot
  changes. Changing a passphrase re-wraps only that one slot.
- **`protection: "none"`** means exactly what it says — `data` sits in the
  file as plain JSON, and the front door says so plainly, so nobody mistakes
  "the viewer folds drafts by default" for real protection.
- **Slot labels and hints are visible pre-unlock, by design** — that's how a
  reader knows which of several passphrases is theirs. They're bound into
  each slot's authenticated encryption as additional data (AAD), so nobody
  can rewrite a label or hint (say, into a phishing instruction) without
  breaking that slot.
- **Encryption reuses the app's existing primitives exactly**: PBKDF2-SHA256
  → AES-256-GCM, the same as today's export envelope and draft-at-rest
  encryption. Only the *container* around them is new.

### AAD (additional authenticated data)

Both the main ciphertext and every wrapped key are bound to context, so a
tampered or swapped-in piece fails to decrypt rather than silently working
somewhere it shouldn't:

```text
main data:   lifepackage-plan-aad/v1\n<planId>\n<revision>
each slot:   lifepackage-plan-slot-aad/v1\n<planId>\n<slotId>\n<label>\n<hint>
```

### Recovering a plan without the app

[`recover.js`](./recover.js) is the canonical recovery tool, and it is
embedded verbatim inside every plan file (see below) — a plan never depends
on this repository, this project, or a package index still being reachable,
to be recovered. It needs nothing but a Node runtime: PBKDF2 and AES-GCM come
from Node's built-in Web Crypto (`crypto.subtle`), the exact same API the
embedded viewer itself uses. Zero install, zero third-party dependency, zero
network request — a deliberate choice: a recovery tool whose first line is
`pip install` already depends on a package index still existing, still
serving wheels for whatever platform someone's on decades from now, and
that's precisely the dependency class this format exists to remove.

```text
node recover.js my-plan.html
node recover.js my-plan.html --passphrase "..."
```

[`recover.py`](./recover.py) is kept as a second worked example, for someone
who only has Python, with its one real dependency documented up front
(`pip install cryptography` — Python has no AES-GCM in its standard library,
and hand-rolling AEAD is exactly the kind of bug a recovery-of-last-resort
tool can't afford). Both scripts implement the same spec independently and
are tested against the same fixtures — enforced in CI
([`.github/workflows/format-v1.yml`](../.github/workflows/format-v1.yml) runs
[`schema/fixtures/format-v1/verify.mjs`](./schema/fixtures/format-v1/verify.mjs)
on every change to either script or the fixtures) — so they're auditable
against each other, call by call, not just claimed to be.

Worked examples of every shape above — passphrase-free, one slot, and
multiple slots — are checked into
[`schema/fixtures/format-v1/`](./schema/fixtures/format-v1/), together with
the passphrases needed to open them, and they are kept forever: once a
format version ships, its fixtures never change, so any implementation can
always be tested against everything the format has ever had to open. The
real acceptance test for this whole section is **"any engineer, any
language, under an hour"** — not "as long as Node or Python still work."
`recover.js` and `recover.py` are worked proofs that the spec above is
sufficient on its own; they are not themselves the guarantee. `FORMAT.md`
plus the fixtures are.

### The recovery script travels with the file

Every plan `.html` embeds the full text of `recover.js` in a plain
`<script type="text/plain" id="openfirst-recover-js">` block (inert — never
executed by a browser), with a comment near the top of the document pointing
to it. Anyone with the file, a text editor, and "view source" can pull the
script out, save it as `recover.js`, and run it against the very file they
got it from — no internet connection and no copy of this repository
required.

## Package Shapes

The source of truth is always `lifepackage.json`. A package may be:

- a single `lifepackage.json` file,
- a folder containing `lifepackage.json`, `manifest.json`, `START_HERE.txt`, and
  optional `attachments/`,
- a `.zip` of that folder,
- or an encrypted JSON envelope whose plaintext is the package `.zip`.

These shapes remain valid *inputs* for existing files, kept for backward
compatibility with older backups, but `.zip` and the standalone encrypted-JSON
envelope are retired as things the app *produces* — the plan `.html` container
above is the one artifact going forward.

Legacy packages named `inheritance.json` with `schema:
"inheritance-package/v1"` still open in OpenFirst. When you save them, the new
package uses `lifepackage.json` and `schema: "lifepackage/v1"`.

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

Readiness checks and dry-run notes are owner data. They travel inside the plan
file's data like everything else — the same as draft guides — but the app never
renders them to a read-only heir reader. This is view-layer hiding, not a
separate export with the data physically removed.

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
