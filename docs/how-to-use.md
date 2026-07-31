# How to use OpenFirst

A plan takes about an evening to build by hand — or minutes to scaffold with AI
and then refine. No data leaves your device.

## The 60-second picture

1. **Build** your plan in the app (people, places, items, files, guides) — it
   autosaves straight into one `.html` file as you go.
2. **Protect it**, optionally — each person can hold their own passphrase to
   the same file, or leave it passphrase-free.
3. **Share it** with your heirs (USB stick, drive, print any passphrase
   separately). They double-click it; it opens offline, no app or account
   needed.

---

## Option A — let AI do the heavy lifting (recommended start)

Defining all the people, places and items by hand is the slow part. An AI can do
it for you.

1. Open **[the AI prompt](ai-builder-prompt.md)** and copy it into any capable AI
   (Claude, ChatGPT, Gemini, or a local model for maximum privacy).
2. Answer its questions in plain words. **Describe structure, not secrets** —
   e.g. "a Trezor at home, a backup at a bank in another country," never a PIN or
   seed phrase.
3. It outputs a `.json` plan file. In the app, choose **Open existing plan** and
   pick that file.
   - If the file is malformed, the app says what's wrong on import — paste that
     back to the AI and ask it to fix it.
4. Now finish the parts that must stay local (below).

> **Why this is private:** the AI runs on *your* side; this project never sees
> your data. We only provide the prompt and the open schema. Even so, keep
> descriptions general — structure alone can be sensitive.

## Option B — build by hand

Click **Create new plan** and work through the left nav: **People → Roles →
Locations → Items → Files → Guides**. Open the [Demo](https://openfirst.io/demo/) first to see a finished
example.

---

## Finish locally (always done in the app)

- **Fill in real values** the AI deliberately left out.
- **Write/refine guides.** Plain Markdown; cross-link anything with `[[…]]`, and
  link a set of files or items with a tag. Mark anything unfinished as **Draft**
  — drafts stay in your working copy but are **left out of the heir's reader**.
- **Add and tag files.** Upload scans/photos/PDFs; add tags like `tax`, `will`,
  `bitcoin` to group them. PDFs preview inline (use the expand button to read
  full-screen).
- **Tag items too.** Add the same kind of tags to Items (from the item's detail
  or in bulk from the Items list) — item tags are a separate list from file
  tags, and also drive the Map's tag filter below.
- **Filter and sort any list.** People, Items, Locations and Files each have a
  **Filter** button — narrow by role, importance, location, who-can-access or tag
  (pick several in one group to widen, across groups to narrow), and **Sort** to
  reorder. It's just a view; nothing in the plan changes.
- **Check the Map.** The "where is what" view shows each place with its items
  nested inside — a quick sanity check. Once any item has a tag, a **Filter**
  control appears above the map to narrow it down to matching items and their
  parent locations; printing the map shows which tag(s) are applied as plain text.

## Protect your working plan

Settings → **Plan protection** encrypts the plan file itself, the same file
you'll hand your heirs:
- **+ Add a passphrase** for each person who might need to open it, with a
  label and an optional hint (e.g. "For Amanda — our anniversary, reversed").
  Any one passphrase opens the whole plan.
- Add, change, or remove passphrases any time. Removing the last one turns
  protection off again.
- **Lock plan** (top bar) drops the plan from memory without losing your place
  — reopening it asks for one of the passphrases again.

## Share it with your heirs

There's no separate export — the plan `.html` file you've been autosaving into
is the one file your heirs open. Copy it wherever it needs to go (USB stick,
drive, printed instructions on where to find it).

- **Drafts never show up for a reader.** Anything marked Draft stays out of the
  nav, direct links, and search for anyone opening the file read-only — even
  you, previewing as a role — while still being right there in the file the
  moment you open it for editing again.
- If **Plan protection** is on, each heir uses their own passphrase (the one
  you set up for them) to open the same file — nothing separate to add at
  share time.
- If you left the plan passphrase-free, anyone with the file can open it — an
  explicit, honest tradeoff; make sure delivery itself is the safeguard.

## Keep it current

Revisit every 6–12 months: update values that changed, then give your heirs a
fresh copy of the same plan file. The underlying data is plain JSON + Markdown
inside the file, so your plan stays readable far into the future — with or
without this app.
