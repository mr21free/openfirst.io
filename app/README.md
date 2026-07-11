# openfirst.io

A calm, **local-first, offline** way to create, edit, and read a life package
for inheritance, recovery, and handover. No server, no account, no tracking. The whole app is a single
self-contained `index.html` that runs from disk in any modern browser, so it
keeps working even if this project disappears.

The **app** is openfirst.io; the **open file format** it reads/writes is Life
Package (`lifepackage/v1`) so other tools can adopt it. See [FORMAT.md](./FORMAT.md).

## What it does

- Open a **life package** — a folder, a `.zip`, or a single
  `lifepackage.json` — entirely in the browser. Nothing is uploaded. Legacy
  `inheritance.json` packages still open.
- Create and edit the people, roles, locations, items, guides, files, languages,
  and map permissions that make up a plan.
- Asks the reader *“who are you?”* and shows the right things first for that role.
- Lays the plan out gently: a personal letter, a *start here*, topic guides, the
  people who can help, where things are kept, and everything in the plan.
- Resolves the graph: click any **person / item / location** to see where it
  lives, who can reach it, what it depends on, and what depends on it.
- Cross-links inside guides are clickable.

## Privacy & durability

- **No network.** A strict Content-Security-Policy (`connect-src 'none'`) means a
  tampered package cannot exfiltrate anything. There are no analytics, no fonts
  or scripts from the web — everything is inlined.
- **Safe rendering.** Guide text is rendered through a small Markdown subset that
  never emits raw HTML, so a package cannot inject scripts.
- **Outlives the app.** The package is plain, open files (JSON + Markdown +
  folders). Even with no app at all, the text inside is readable. The format is
  documented in [FORMAT.md](./FORMAT.md) and [schema/lifepackage.schema.json](./schema/lifepackage.schema.json).
- **Fits on the key.** The built `index.html` is one file — you can keep it on the
  same encrypted USB as the package and open it offline.

## Develop

```bash
npm install
npm run dev           # live whole-site dev server: /, /build/, /open/, /demo/
npm run build         # → dist/ with the marketing root and app routes
npm run preview:site  # rebuild, then serve the production IA locally
```

## Use the built site

For the full website locally, use `npm run preview:site` and open the printed
URL. The built tree mirrors the public IA:

- `/` — static marketing home (`dist/index.html`)
- `/build/` — app builder (`dist/build/index.html`)
- `/open/` — app launcher for opening existing packages
- `/demo/` — app with the sample plan

To run the durable app file directly from disk, open `dist/build/index.html`
(double-click, or `file://...`). Click **Demo** to explore a demo plan, or drop
your own package folder / `.zip` / `lifepackage.json` (`inheritance.json` still
works for older packages).

## Samples (for testing the drop zone)

Under `public/`:

- `sample-package/` — a full package **folder** (drag it in).
- `sample-package.zip` — the same package zipped.
- `sample-package/lifepackage.json` — just the source (the demo is JSON-only).
- `sample-package.encrypted.json` — a **password-protected** package. Password:
  `open-sesame-2026`. Dropping it makes the app prompt for the password.

Regenerate the `.zip` + encrypted variant (after editing `sample-package/`) with
`node scripts/build-samples.mjs`.

## Optional password encryption

A package can be locked with a password (AES-256-GCM + PBKDF2-SHA256, the same
scheme as freedomclock.io). The encrypted file is a self-describing JSON envelope
whose plaintext is the package `.zip`; the app decrypts it on the device and the
password never leaves it. It’s also decryptable **without this app** — see the
standalone recipe in [FORMAT.md](./FORMAT.md). Minimum password length: 12.

## Layout

```
schema/lifepackage.schema.json   JSON Schema for the package format (v1)
public/sample-package/           a complete on-disk demo package
src/sample/                      the demo bundled into the app ("Try the sample")
src/lib/package.js               parse + resolve the graph
src/lib/load.js                  load from folder / zip / json / bundled sample
src/lib/markdown.js              safe Markdown subset renderer
src/components/                  Landing, Reader, Drawer, editor forms and views
```

## License

**App:** [AGPL-3.0](./LICENSE) © 2026 Miroslav Remias — free to use, self-host,
and audit; embedding or offering it as a service requires either open-sourcing
your derivative or a commercial license (contact info@openfirst.io).

**Format:** the `lifepackage` specification, JSON Schemas, and samples are
[MIT](../docs/LICENSE-FORMAT.md) — your heirs' file, and any tool that reads or
writes it, owes this project nothing, forever.
