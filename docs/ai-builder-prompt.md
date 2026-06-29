# Build your plan with AI — the prompt

You don't need to fill in everything by hand. Paste the prompt below into **any
capable AI** (Claude, ChatGPT, Gemini, a local model — your choice), describe
your situation in plain words, and it will produce a **plan file** you import
into the app with **Open existing plan**.

> **Privacy first.** This runs in *your* AI, not ours — we never see anything.
> Still: **do not paste real secrets** (no PINs, seed phrases, passwords,
> private keys, account numbers). Describe the *structure* — "I keep a Trezor at
> home and a backup at a bank in another country" — and add the real values
> yourself, locally, in the app afterwards. The structure alone can be sensitive,
> so keep it general (use a private/local model if you want maximum privacy).

---

## The prompt (copy everything in this box)

````text
You are helping me build an inheritance / "in case I die" plan as a single JSON
file in the format "inheritance-package/v1". The plan is a MAP of where things
live and who should receive them — NOT a store of raw secrets.

Follow these rules exactly:

1. Output ONE JSON object and nothing else (no prose, no markdown fences) when I
   ask for the final file. Until then, interview me.
2. Conform to the schema summarized below. Unknown/extra fields are allowed but
   prefer the documented ones.
3. IDs are arbitrary strings but MUST be unique within their array and
   referenced consistently. Use readable ids like "person_jane", "loc_home",
   "item_trezor", "guide_first_steps".
4. Every reference must resolve: ids in location_ids / access_person_ids /
   attachment_ids / guide_ids / audience_roles / group / owner_id / parent_id /
   references.* MUST point to an entity that exists in the file.
5. NEVER invent or include real secrets (PINs, seeds, passwords, keys, account
   numbers). If a value is sensitive, describe where/how to find it instead, and
   set "sensitive": true on that item.
6. Write the guides as clear, calm Markdown for a non-technical reader (e.g. my
   spouse). Inside guide content you may cross-link other entities with [[id]]
   tokens (and list those ids in that guide's "references"), and link a group of
   files with [#tag](#tag:slug).
7. Leave "attachments" empty — I will add real files in the app.

SCHEMA SUMMARY
- Top level: { "schema": "inheritance-package/v1", "package": {...}, "people":
  [...], "roles": [...], "locations": [...], "items": [...], "guide_groups":
  [...], "guides": [...], "attachments": [] }
- package: { id, title, owner_id (a people id), created (YYYY-MM-DD), updated,
  languages: ["en"], default_language: "en" }
- roles[]: { id, name }  // e.g. owner, primary_heir, beneficiary, professional, friend
- people[]: { id, name, nickname?, roles: [roleId], importance?: high|medium|low,
  notes?, sensitive?: bool }
- locations[]: { id, name, parent_id?, order?, notes?, access_person_ids?,
  importance? }   // nest with parent_id: Country > City > Home > Safe
- items[]: { id, name, description?, notes?, price?, importance?, location_ids?,
  container_ids?, access_person_ids?, depends_on_ids?, attachment_ids?, guide_ids?, sensitive? }
  (container_ids = item ids this is stored INSIDE, e.g. a PIN inside a password manager)
- guide_groups[]: { id, name, order? }
- guides[]: { id, title, group?, order?, importance?, draft?: bool,
  content: { "en": "## ...markdown..." },
  references?: { person_ids?, role_ids?, item_ids?, location_ids?, guide_ids?,
  attachment_ids? },
  audience_roles?: [roleId], audience_person_ids?: [personId] }

MINIMAL VALID EXAMPLE (shape only):
{
  "schema": "inheritance-package/v1",
  "package": { "id": "plan-1", "title": "My inheritance plan",
    "owner_id": "person_me", "created": "2026-01-01", "updated": "2026-01-01",
    "languages": ["en"], "default_language": "en" },
  "roles": [ { "id": "owner", "name": "Owner" },
             { "id": "primary_heir", "name": "Primary heir" } ],
  "people": [ { "id": "person_me", "name": "Me", "roles": ["owner"] },
              { "id": "person_spouse", "name": "Jane", "roles": ["primary_heir"] } ],
  "locations": [ { "id": "loc_country", "name": "Country X", "order": 0 },
    { "id": "loc_home", "name": "Home safe", "parent_id": "loc_country", "order": 0 } ],
  "items": [ { "id": "item_will", "name": "Will (original)", "importance": "high",
    "location_ids": ["loc_home"], "access_person_ids": ["person_spouse"] } ],
  "guide_groups": [ { "id": "general", "name": "General", "order": 0 } ],
  "guides": [ { "id": "guide_first", "title": "First steps", "group": "general",
    "order": 0, "audience_roles": ["primary_heir"],
    "content": { "en": "## First steps\n\nTake your time. The will is at [[loc_home]]; [[person_spouse]] can open it." },
    "references": { "location_ids": ["loc_home"], "person_ids": ["person_spouse"] } } ],
  "attachments": []
}

Now interview me: ask short, grouped questions about my people and their roles,
the places I keep things, the items (accounts, wallets, keys, documents,
devices), and what guidance each heir needs. Ask only for non-sensitive
structure. When I say "generate", validate that every reference resolves and
every id is unique, then output the final JSON only.
````

---

## After the AI gives you the file

1. Save the AI's JSON output to a file, e.g. `my-plan.json`.
2. Open the app → **Open existing plan** → choose that file. (If anything is
   malformed, the app tells you what's wrong on import — paste the error back to
   the AI and ask it to fix it.)
3. Now do the parts that must stay local: fill in real values, set guides you're
   still drafting to **Draft**, and **upload your files** (and tag them). Then
   **Export** the encrypted reader for your heirs.

The machine-readable contract is [`inheritance-package.schema.json`](./inheritance-package.schema.json);
the human reference is [`SCHEMA.md`](./SCHEMA.md). Both are public, so a capable
AI can also read them directly from the repository.
