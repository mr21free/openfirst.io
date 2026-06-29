# Life Plan — a calm place to put your affairs in order

A **local-first, offline, no-server** tool to build an inheritance / "in case I
die" plan and hand your loved ones a single file they can open with no app, no
account, and no internet.

You build a plan — the **people**, the **places** things live, the **items**
(accounts, wallets, keys, documents), the **files**, and plain-language
**guides** — and export a **self-contained `start-here.html`** your heirs just
double-click. Optionally password-protect it.

## Principles

- **Nothing leaves your device.** No server, no account, no telemetry. The
  builder auto-saves locally (IndexedDB); export writes a file to your disk.
- **Offline forever.** The heir's reader is one HTML file that works with no
  internet.
- **Durable, open format.** A plan is plain **JSON + Markdown**
  (`inheritance-package/v1`) — readable for years without this app. See
  [`docs/SCHEMA.md`](docs/SCHEMA.md).
- **A map, not a vault.** The plan describes *where* secrets live and *how* to
  find them — you decide what (if anything) to store directly. Strong encryption
  is available for export (AES‑256‑GCM, PBKDF2‑600k); a 6‑word passphrase is
  recommended over a PIN.

## What's inside a plan

- **People** & **Roles** — who's involved and what each should receive/see.
- **Locations** — a nestable tree (Country → City → Home → Safe).
- **Items** — accounts, wallets, keys, documents, devices; linked to where they
  live, who can access them, what they depend on, and which files document them.
- **Files** — scans/photos/PDFs, organised with **tags** (PDFs preview inline).
- **Guides** — calm Markdown instructions ("First steps", "How to access my
  Bitcoin"), per-language, with cross-links to any entity.
- **Map** — a "where is what" view: locations as nested containers with their
  items inside, drill-down one level at a time.

## Build it with AI (optional, fastest start)

Don't fill everything in by hand. Paste our prompt into **your own AI**,
describe your setup in plain words (no real secrets), and import the result.

→ **[docs/ai-builder-prompt.md](docs/ai-builder-prompt.md)** — the ready-to-paste
prompt. Privacy stays in your hands; we never see your data.

## Run it

```bash
cd app
npm install
npm run dev        # http://localhost:5173 — the builder
npm run build      # produces app/dist/index.html (single self-contained file)
npm test           # headless end-to-end checks (needs Google Chrome)
```

Open the built `app/dist/index.html` directly, or host it — it's one file. Use
**Demo** to explore a realistic sample.

## Documentation

- [How to use](docs/how-to-use.md) — step-by-step, including the AI flow.
- [Schema reference](docs/SCHEMA.md) — human-friendly.
- [`inheritance-package.schema.json`](docs/inheritance-package.schema.json) — the
  formal JSON Schema (for validation / AI).
- Sample plan: [`app/src/sample/inheritance.json`](app/src/sample/inheritance.json).
