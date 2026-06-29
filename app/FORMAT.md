# Inheritance Package Format — v1

`schema: "inheritance-package/v1"`

This document describes the open, durable format an inheritance plan is stored
in. The goals: **human-readable**, **machine-readable**, and **still openable in
10+ years** with no server, account, or proprietary runtime. The authoritative
contract is [schema/inheritance.schema.json](./schema/inheritance.schema.json);
this is the friendly explanation.

## A package is a folder

```
InheritancePackage_YYYY-MM-DD/
  START_HERE.txt        Plain-text entry point for a person with no app.
  manifest.json         id, schema version, dates, language index, file map.
  inheritance.json      The single machine-readable source of truth (the graph).
  guides/               Human-readable renderings of the guides (Markdown), per language.
  print/                Print-ready artifacts: guide, envelope, labels.
  attachments/          Original files (images, PDFs) referenced by relative path.
```

- `inheritance.json` is what the Reader/Builder app round-trips.
- `guides/` and `print/` are **renderings** of the same content, so the plan is
  fully usable even with no app. They are derived; `inheritance.json` wins.
- The package may also be shipped as a single `.zip`, or you can hand the app
  just `inheritance.json` (without attachments).

## The data model is a property graph

Six entity types, connected by **id references**. Default posture is a **map of
where things are**, not a vault of secrets (see "Secrets" below).

### `package` (metadata)
`id`, `title`, `owner_id`, `created`, `updated`, `languages[]`,
`default_language`. `updated` is shown to readers as “Last updated”.

### `people[]`
`id`, `name` (legal), `nickname` (familiar name shown in lists/guides when set),
`display_as`, `roles[]`, `languages[]`, `country`, `location_id`, `contacts[]`,
`verification{question, answer_hint}`, `boundaries`, `importance`, `order`.

Roles: `owner`, `primary_heir`, `helper`, `beneficiary`, `expert`, `contact`,
`professional`, `guardian`. `verification` is an anti-scam control question
(e.g. confirming a Bitcoin helper’s identity). `boundaries` records role limits
(“helper only — never acts alone unless the primary heir is unavailable”).

### `locations[]`
`id`, `name`, `type` (`home_safe`, `bank_box`, `office`, `residence`, `cloud`,
`with_person`, `other`), `country`, `parent_id` (nesting),
`access_person_ids[]`, `keys_required_item_ids[]`.

### `items[]` — assets, credentials, devices, documents, infrastructure
Fixed fields: `id`, `name`, `type`, `importance`, `description`,
`location_ids[]` (multiple = redundant copies), `access_person_ids[]`,
`depends_on_ids[]`, `guide_ids[]`, `attachment_ids[]`, `sensitive`, `secret`.
Plus a free-form, type-specific `properties{}` bag.

Types: `password_record`, `btc_seed`, `btc_passphrase`, `btc_wallet`,
`hw_device`, `twofa`, `secret_split_part`, `account_investment`,
`bank_account`, `digital_service`, `recovery_artifact`, `legal_document`,
`sim_card`, `other`.

`depends_on_ids` is the key edge: it lets a reader (and a future audit) trace
single points of failure and circular dependencies — e.g. an account that needs
the SIM for 2FA, or a multisig wallet that needs its seeds.

### `guides[]` — human-readable instructions
`id`, `title`, `type` (`start_here`, `topic`, `print_guide`, `envelope`,
`labels`), `folder_id`, `audience_roles[]` / `audience_person_ids[]`, `updated`,
`languages[]`, `content` (Markdown **keyed by language code**), and
`references{person_ids, item_ids, location_ids, guide_ids}` so cross-links can
be rendered and dangling links detected.

### `folders[]`
`id`, `name`, `parent_id`, `is_print` (the special PRINT group), `description`.

### `attachments[]`
`id`, `filename`, `path` (relative, e.g. `attachments/bitcoin/descriptor.png`),
`mime`, `description`, optional `item_id` / `guide_id` link.

## Secrets: pointer-first, flagged exception

By default the package is a **map**: it says *where* a secret lives and *how* to
combine it (“Part 1 in Home Trezor, Part 2 in Bank X”), never the secret itself.
This keeps the security benefit of splitting secrets across places even if one
copy of the package leaks.

A raw secret is stored only when an item is explicitly marked `sensitive: true`
and carries a `secret { kind, value, note }` object. The schema enforces that a
`secret` requires `sensitive: true`, and apps must visibly flag such items.

## Multi-language

`package.languages` lists every language used. Any guide’s `content` is an
object keyed by language code (`{ "en": "...", "sk": "..." }`). A reader shows
the chosen language and falls back to the default. The same guide therefore holds
all its translations — switching language shows the translated version of the
same guide.

## Ordering

People, locations, items and guides may carry an optional numeric `order` (lower
= earlier) so the plan author controls the sequence they appear in. Entries
without `order` sort after those with one (then by importance, then name).

## Nesting locations

Locations nest to any depth via `parent_id` (e.g. Country › City › Home › Safe).
The author builds whatever hierarchy fits; `type` is only a loose label for the
marker, not a fixed level.

## Optional password encryption

For people who won’t keep the package on encrypted hardware, the whole package
can be locked with a password. The package `.zip` is encrypted into a small,
self-describing JSON envelope (`inheritance-encrypted/v1`):

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

- Scheme: **AES-256-GCM** with a **PBKDF2-SHA256** derived key (same primitives as
  freedomclock.io; iterations raised to OWASP’s 600k and stored in the file).
- The plaintext is the package `.zip`. When the app meets such a file it prompts
  for the password and decrypts **on the device** — the password is never sent
  anywhere.
- **Minimum password length: 12** (a 5-word passphrase is ideal).
- Because every parameter is in the envelope, it is **decryptable without this
  app**. Standalone recipe (Node 18+, Web Crypto):

```js
import { readFileSync, writeFileSync } from 'node:fs';
const PASSWORD = '...';
const env = JSON.parse(readFileSync('package.encrypted.json', 'utf8'));
const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSWORD), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: b64(env.salt), iterations: env.iterations, hash: 'SHA-256' },
  km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
const zip = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ciphertext));
writeFileSync('package.zip', Buffer.from(zip)); // → ordinary package .zip
```

Encryption is optional: an unencrypted package is just the folder/zip described
above. Keep the password and the package separate.

## Durability rules

1. Plain text only — JSON + Markdown + folders. No binary container, no DB.
2. The human renderings (`guides/`, `print/`, `START_HERE.txt`) mean the plan is
   readable even with no app.
3. `schema` is versioned so future readers can recognise and migrate it.
4. Attachments are real files referenced by path — never base64-bloated into the
   JSON.
