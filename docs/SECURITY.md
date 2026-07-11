# Security & threat model — OpenFirst

OpenFirst builds an inheritance / "in case I die" plan **entirely on your
device** and exports a single file your heirs can open with no app, account, or
internet. This document is the honest version: what we protect, what we
deliberately don't, and how you can verify all of it yourself. For this kind of
product, being clear about the limits *is* the security feature.

If you find a vulnerability, please report it privately (see
[Reporting](#reporting-a-vulnerability)).

---

## Design principles

- **Local-first, no server.** There is no backend. The app is static files.
  Nothing you type is uploaded, because there is nowhere to upload it to.
- **A map, not a vault.** The plan describes *where* secrets live and *how* to
  find them. It does **not** store seeds, passphrases, PINs, or passwords. The
  app removed the ability to store a raw secret on purpose, and strips any that
  a hand-edited or older file tries to smuggle in.
- **Outlives the company.** Every export is an open, documented format (plain
  JSON + Markdown + files, or one self-contained HTML). It stays readable and
  decryptable with standard tools in 10–20 years, with no OpenFirst in the loop.
  See [FORMAT.md](../app/FORMAT.md).
- **Verifiable.** The whole app is open source and builds to one auditable file.

---

## What is protected

### Provably offline
The production build ships a strict Content-Security-Policy with
`connect-src 'none'` (see `app/vite.config.js`). Even a maliciously crafted
package cannot make the reader phone home — the browser forbids every network
connection. All code, fonts, and styles are inlined; nothing is fetched.

### Export encryption (optional password)
When you password-protect an export, the package `.zip` is encrypted with:

- **AES-256-GCM** for confidentiality and integrity,
- a key derived by **PBKDF2-HMAC-SHA256, 600,000 iterations** (OWASP 2023
  guidance), with a random 16-byte salt and 12-byte IV per file.

The parameters are stored in a self-describing JSON envelope, so the file can be
decrypted **without OpenFirst** by anyone who reads the recipe in
[FORMAT.md](../app/FORMAT.md).

The real strength against offline guessing is **passphrase entropy**, not the
KDF. The app generates and nudges you toward a 6-word diceware passphrase
(~77 bits), which makes brute force infeasible. A short PIN does not — a 6-digit
PIN falls to a single GPU in under a minute regardless of the KDF.

**Tamper-evident metadata.** The visible fields shown before you decrypt — most
importantly the password *hint* — are bound to the ciphertext as AES-GCM
additional authenticated data. Nobody can rewrite the hint on an encrypted file
(for example, into a phishing instruction aimed at a grieving heir) without
breaking decryption.

### Draft-at-rest encryption (optional)
While you build a plan, the auto-saved draft normally lives **unencrypted** in
your browser's IndexedDB. You can turn on **Draft protection** (Settings) to
encrypt the working draft — the plan JSON and every attached file — with a
passphrase, using the same AES-256-GCM + PBKDF2 primitives. The key is held in
memory only; you can lock the draft to drop it from memory, and resuming asks
for the passphrase.

The plan's **title** is kept readable so the "Resume a draft" list is usable —
keep the title non-sensitive.

### Safe rendering of package content
Guide text is Markdown rendered by a small, hand-written renderer that
HTML-escapes everything and only emits a fixed set of safe tags. A tampered
package cannot inject `<script>`, `onerror=`, `javascript:` URLs, or similar.
Links are restricted to `http(s):` and `mailto:`.

---

## What is NOT protected — read this

- **Your device while it's unlocked.** OpenFirst cannot protect you from
  malware, a malicious browser extension, or someone sitting at your unlocked
  screen while you edit. At that moment the plan and any in-memory key are, by
  necessity, in memory. Draft encryption protects **copies at rest** (a cloned
  disk, a copied browser profile, an un-encrypted backup) — not a live-
  compromised browser.
- **The plan is not a secret store.** Do not paste seeds, private keys,
  passwords, or PINs into it, even into notes or dry-run fields. Keep those on
  hardware, paper, or a password manager and *point* to them.
- **A lost passphrase is unrecoverable.** There is no reset and no backdoor —
  that's the point. If you forget an export password or a draft passphrase, that
  file/draft is gone. Keep your durable encrypted export somewhere safe.
- **The password hint is plaintext** (though tamper-evident). Never make the
  hint reveal the password.
- **Discovery and delivery are yours.** OpenFirst can't make your heir *find*
  the plan or receive the password. That's an out-of-band, human step (a sealed
  letter, a lawyer, split among relatives). See the guide templates for help.

---

## Building on native platform tools

OpenFirst is a runbook, not a custodian. For the parts it can't own, it points
you at durable, institutional tools you already have: Apple Digital Legacy,
Google Inactive Account Manager, your password manager's emergency access, and —
for Bitcoin — collaborative multisig or on-chain timelocks. Those outlive any
startup, including this one.

---

## Verify it yourself

1. **Read the source.** It's small and dependency-light (one runtime dependency,
   `fflate`, for zip; everything else is native Web Crypto).
2. **Reproduce the build.** `cd app && npm install && npm run build` produces one
   `dist/index.html`. Open it from disk (`file://`) with your network throttled
   to offline — it works, because it never needed the network.
3. **Inspect an encrypted export.** It's JSON: you can see the algorithm, KDF,
   iteration count, salt, and IV, and decrypt it with the standalone recipe in
   [FORMAT.md](../app/FORMAT.md) using nothing but Node.js or Web Crypto.
4. **Watch the network.** With devtools open, load a heir reader and confirm zero
   requests leave the page.

---

## Reporting a vulnerability

Email **security@openfirst.io** with steps to reproduce. Please give us reasonable
time to fix an issue before disclosing it publicly. We'll credit you unless you
prefer otherwise.
