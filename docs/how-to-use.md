# How to use OpenFirst

A plan takes about an evening to build by hand — or minutes to scaffold with AI
and then refine. Everything stays on your device.

## The 60-second picture

1. **Build** your plan in the app (people, places, items, files, guides).
2. **Export** a single `start-here.html` — optionally password-protected.
3. **Give it** to your heirs (USB stick, drive, print the password separately).
   They double-click it; it opens offline, no app or account needed.

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
Locations → Items → Files → Guides**. Use **Demo** first to see a finished
example.

---

## Finish locally (always done in the app)

- **Fill in real values** the AI deliberately left out.
- **Write/refine guides.** Plain Markdown; cross-link anything with `[[…]]`, and
  link a set of files with a tag. Mark anything unfinished as **Draft** — drafts
  stay in your working copy but are **left out of the heir's reader**.
- **Add and tag files.** Upload scans/photos/PDFs; add tags like `tax`, `will`,
  `bitcoin` to group them. PDFs preview inline (use the expand button to read
  full-screen).
- **Filter and sort any list.** People, Items, Locations and Files each have a
  **Filter** button — narrow by role, importance, location, who-can-access or tag
  (pick several in one group to widen, across groups to narrow), and **Sort** to
  reorder. It's just a view; nothing in the plan changes.
- **Check the Map.** The "where is what" view shows each place with its items
  nested inside — a quick sanity check.

## Export for your heirs

Top bar → **Export**:
- **Self-contained reader** (`start-here.html`) — the one file your heir opens.
  Drafts are excluded automatically.
- **Password-protect** it for safety. Prefer the suggested **6-word passphrase**
  over a short PIN (a 6-digit PIN can be brute-forced in under a minute; a 6-word
  passphrase is effectively uncrackable). Store the password separately from the
  file.
- The plain `.zip` / encrypted `.json` exports keep *everything* (including
  drafts) as your own durable backup.

## Keep it current

Revisit every 6–12 months: update values that changed, re-export, and replace the
copy you gave your heirs. The format is plain JSON + Markdown, so your plan stays
readable far into the future — with or without this app.
