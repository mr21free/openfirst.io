# OpenFirst design guide

The rules that keep the product feeling like one calm, premium thing. Written
for humans **and for AI assistants working on this codebase — follow these
patterns; don't invent parallel ones.** If a pattern is missing here, add it
here in the same change that introduces it.

## Character

**The butler for builders.** Calm, competent, discreet. Short sentences. Never
exclaims, never guilt-trips, always says what happens next ("Saved on this
device."). One moment of warmth per screen, not confetti. Playfulness lives in
microcopy ("Take your time. There is no rush."), never in visuals.

## Tokens

- Colors, spacing and type come from [src/styles/app.css](src/styles/app.css)
  (heaven-blue system). Never hard-code a color a token exists for.
- Type — one family, two voices: **IBM Plex Sans** is the human voice
  (headings at 600–650, body, buttons, dialogs); **IBM Plex Mono** is the
  machine voice (eyebrows, field labels, input values, file names, numbers,
  `.tiny` metadata). Guide text uses the plan's chosen reading font.
- Motion: 120–150ms ease, opacity/background/color only. Nothing bounces.

## Radius language

- **Surfaces are sharp (0):** cards, dialogs, drawers, inputs, popovers,
  previews, icon-button hover washes. Paper has corners.
- **Buttons are rounded rectangles (8px):** every `.btn` variant and
  button-like control (add-row buttons, toolbar refs, map crumbs).
  Decided 2026-07-11 (Miro; smallpdf/secubit reference) — replaced pills.
- **Chips share the 8px button radius** (map chips set the look; home page
  trust chips and readiness/audience chips match).
- **Pills (999) survive only where the shape IS the meaning:** the switch
  knob/track, count badges, avatar dots. Tooltip bubbles stay 6px.
- Never introduce another radius.

## Buttons — one system, `app.css`

Every clickable text control is a `.btn` variant. **No new one-off button
styles in components** — if a variant is missing, add it to app.css.

| class | use |
|---|---|
| `.btn` | default (paper, hairline border, 8px rounded rect) |
| `.btn.btn-primary` | the one main action of a screen/dialog |
| `.btn.btn-secondary` / `.btn.btn-ghost` | quieter siblings |
| `.btn.btn-danger` | destructive confirm |
| `.btn.btn-small` | compact contexts (banners, toolbars, inline forms) |
| `.btn-link` | text-only quiet action (Cancel, Turn off…) |

## Icon buttons — the **bare** pattern (decided 2026-07-03)

One global class: `.iconbtn` (app.css). 36×36 hit area, transparent until
hover, then a soft `--accent-wash` rectangle (sharp corners). Glyphs are 15–18px
stroke SVGs at `stroke-width="2"`, round caps — same family as the logo. No
emoji glyphs, no framed/circled icon buttons.

Modifiers: `.on` (toggled state), `.danger` (delete intent — warn wash on
hover). Special containers (in-field `.pw-icon`) may keep their own positioning
but follow the same glyph rules.

## Tooltips

Black bubble, Productboard-style: put the label in `data-tip="…"` (NOT `title`
— it would double up) and pick the side that has room with
`data-tip-pos="top|bottom|left|right"` (default bottom). Appears after a 350ms
hover/focus delay. Every icon-only button MUST have both `data-tip` and
`aria-label`.

## Switch

On/off settings use the `Switch.svelte` component (`role="switch"`, pill track,
accent when on) in a row: **icon chip · label + one-line description · switch
on the right** (see Settings → Draft protection). The parent owns the state —
the switch may stay visually off until an async step (e.g. passphrase setup)
completes.

## Dialogs

`.card` + `role="dialog"`/`alertdialog`, sharp corners, **30/32px padding**
(more air than inline cards), accent left edge — warn-colored for danger.
Escape closes; the primary action sits right.

## Passwords & passphrases

Always `PassphraseField.svelte`: in-field eye + copy, strength bar, "Suggest a
passphrase". Hand-typed values require the repeat field (unrecoverable
passwords must be typo-proofed); generated passphrases skip it. Gate submits on
its `confirmOk`.

## Locks

The one lock glyph (rect + shackle path, stroke 2) everywhere a plan/draft is
protected — drafts list (before the title), gates, settings, top bar. Always
`currentColor`, never emoji.

## Banners (edit-mode strips)

Full-width strip under/above the top bar: message left, actions right,
`.iconbtn` ✕ to dismiss. Staleness uses accent-wash; size warning uses the warm
wash. Dismissals that should persist are stored in localStorage under
`openfirst.<thing>:<planId>`.

## Voice checklist for any new copy

1. Would a butler say it? (calm, precise, no exclamation marks)
2. Does it say what happens next?
3. Does it avoid blame and urgency?
4. Is the one warm touch present — and only one?
