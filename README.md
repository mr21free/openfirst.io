# OpenFirst — an inheritance plan your family can actually open

**[openfirst.io](https://openfirst.io)** · a **local-first, offline, no-server**
tool to build an inheritance / "in case I die" plan and hand your loved ones a
single file they open with no app, no account, and no internet.

Your family finds everything, even without you: you build a private map of everything
that matters — the **people**, the **places** things live, the **items**
(accounts, wallets, keys, documents), the **files**, and plain-language
**guides** — all inside **one self-contained `.html` file** your heirs just
double-click. Optionally password-protected, with each person able to hold
their own passphrase to the same file.

Try it in 30 seconds: the **[Demo](https://openfirst.io/demo/)** opens a
realistic sample plan exactly as the primary heir would see it.

## Principles

- **No data leaves your device.** No server, no account, no telemetry. The
  builder auto-saves straight into your plan file (via the File System Access
  API where supported, or repeated downloads otherwise) — there's no separate
  export step.
- **Provably offline.** The built app ships a strict CSP with
  `connect-src 'none'` — even a maliciously crafted plan cannot phone home.
- **A map, not a vault.** The plan records *where* secrets live and *how* to
  find them — never seeds, PINs, or passwords themselves.
- **Durable, open format.** The plan file is a self-contained HTML container
  wrapping a plain **JSON + Markdown** data schema (`lifepackage/v1`) —
  readable for years without this app. See
  [`docs/SCHEMA.md`](docs/SCHEMA.md) for the data schema and
  [`app/FORMAT.md`](app/FORMAT.md) for the container.
- **Legacy-friendly.** Older packages named `inheritance.json` with
  `schema: "inheritance-package/v1"` still open; saving writes the current
  format.
- **Honest security.** A plan can be left passphrase-free, or protected with
  AES-256-GCM + PBKDF2-SHA256 at 600k iterations, where each person holds
  their own passphrase to the same file; optional draft-at-rest encryption
  with idle auto-lock while you build; a tamper-evident passphrase hint. Full
  threat model — including what is deliberately *not* protected — in
  [`docs/SECURITY.md`](docs/SECURITY.md).

## What's inside a plan

- **People** & **Roles** — who's involved, and what each person should see:
  every heir gets their own view of the plan.
- **Access path** — the heir's first screen: "Start here, Amanda." — numbered
  physical steps to reach the plan itself, with a printable envelope insert.
- **Locations** — a nestable tree (Country → City → Home → Safe).
- **Items** — accounts, wallets, keys, documents, devices; linked to where they
  live, who can access them, what they depend on, which files document them,
  and organised with **tags** for grouping, search and map filtering.
- **Files** — scans/photos/PDFs, organised with **tags** (PDFs preview inline).
- **Guides** — calm Markdown instructions ("First steps", "How to access my
  Bitcoin"), per-language, with cross-links to any entity and honest
  "Updated" dates.
- **Readiness** — dry-run checklists: sit down with the person who'll use the
  plan and record what they could actually find, open, and understand.
- **Map** — a "where is what" view: locations as nested containers with their
  items inside.

Free **guide templates** (the first 72 hours, a Bitcoin inheritance runbook,
the dry-run script, a trusted-helper protocol) live at
[openfirst.io/guides](https://openfirst.io/guides/) and open directly in the
app as ready-made plans.

## Build it with AI (optional, fastest start)

Don't fill everything in by hand. Paste our prompt into **your own AI**,
describe your setup in plain words (no real secrets), and import the result.

→ **[docs/ai-builder-prompt.md](docs/ai-builder-prompt.md)** — the ready-to-paste
prompt. OpenFirst never receives this data — but the AI provider you paste it
into might. Use non-sensitive descriptions and check that provider's privacy
terms, or use a local model to avoid external processing entirely.

## Run it

```bash
cd app
npm install
npm run dev          # http://localhost:5173 — whole local site (/ + app pages)
npm run build        # produces app/dist/ with /, /build/, /open/, /demo/
npm run preview:site # rebuilds and serves the production IA locally
npm test             # headless end-to-end checks (needs Google Chrome)
```

The self-contained app file is `app/dist/build/index.html` if you want to
double-click it from disk — it works offline by design.

## Documentation

- [Security & threat model](docs/SECURITY.md) — what's protected, what isn't,
  and how to verify every claim yourself.
- [How to use](docs/how-to-use.md) — step-by-step, including the AI flow.
- [Schema reference](docs/SCHEMA.md) — human-friendly.
- [`lifepackage.schema.json`](docs/lifepackage.schema.json) — the formal JSON
  Schema (for validation / AI).
- Sample plan: [`app/src/sample/lifepackage.json`](app/src/sample/lifepackage.json).

## Licensing

- **App** (builder + reader): [AGPL-3.0](./LICENSE). Free to use, self-host,
  and audit. Embedding it in a product or offering it as a service means either
  open-sourcing your derivative under the AGPL or purchasing a commercial
  license — contact info@openfirst.io.
- **Format** (`lifepackage/v1` spec, JSON Schemas, samples):
  [MIT](docs/LICENSE-FORMAT.md). The file your heirs hold — and any tool that
  reads or writes it — owes this project nothing, forever.
- **Third-party code**: see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
  for the one runtime dependency shipped in the built app and its license.

Want to contribute code? See [CONTRIBUTING.md](CONTRIBUTING.md) — commits
need a DCO sign-off.
