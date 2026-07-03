/*
  Free plan templates — the /guides pages open these via /build/?template=<id>.
  Each is a set of prefilled guides (markdown scaffolds with [bracketed]
  placeholders) dropped into a fresh plan. Pointers only, never secrets —
  same rule as everywhere else.
*/

export const TEMPLATES = {
  'first-72-hours': {
    title: 'First 72 Hours',
    group: 'For the first days',
    guides: [
      {
        id: 'guide_first_72_hours',
        title: 'The first 72 hours',
        content: `## Nothing is on fire

Take your time. There is no rush. Money in accounts stays in accounts. Everything here was built so that **waiting is safe**.

## Day one — people only

Be with the family. If you do one practical thing, call **[first-call person]** — they know this plan exists and will help you slow everything down.

## Day two — the paper with a clock on it

- Order several official copies of the **death certificate** (each bank and insurer wants its own).
- Call **[employer / relevant office]** about pending salary and insurance.
- My funeral wishes are in **[where]** — you don't have to guess anything.

## Day three — find, don't act

- Find (don't open, don't claim): the will **[where]**, insurance papers **[where]**, the safe **[where]**, the keys **[where]**.
- Recurring bills keep paying themselves from **[account]**. Leave them be.

## What NOT to do in the first weeks

- **Do not move any Bitcoin or crypto** — not to "keep it safe", not with anyone's help. It is safest exactly where it is.
- Don't announce anything publicly before the home and accounts are looked after.
- Don't sign anything urgent. Legitimate matters allow weeks.
- Nobody legitimate will ever ask you for passwords, codes, or seed words. Anyone who does is a thief.`
      }
    ]
  },

  'bitcoin-inheritance-runbook': {
    title: 'Bitcoin Inheritance Runbook',
    group: 'Bitcoin',
    guides: [
      {
        id: 'guide_btc_overview',
        title: 'My Bitcoin — the map',
        content: `## The one rule

This plan contains **no seed words, no passphrases, no PINs** — only where things live and who helps. Never write a secret into it.

## What exists

- **[Wallet 1]** — hardware: [model], holds [rough share], device lives at **[location]**.
- **Seed backup** — [paper/steel], at **[location]**; second copy at **[location 2]**.
- **Passphrase ("25th word")**: [exists / doesn't exist]. If it exists: it lives at **[location]** — the seed alone opens an empty-looking wallet, that's normal.
- **Setup type**: [single-sig / multisig N-of-M / timelock]. Wallet fingerprints + descriptor: **[where]**.

## The rules (read twice)

1. There is no customer support. No undo. Nothing is done alone or quickly.
2. **Nobody legitimate ever asks for seed words.** Not the helper, not "support", not a lawyer.
3. Recovery happens WITH **[technical helper]**, on a clean computer, software from the official site.
4. Verify addresses **on the device's screen**, never only on the computer.`
      },
      {
        id: 'guide_btc_recovery',
        title: 'Recovery — step by step',
        content: `## Before touching anything

1. Call **[technical helper]**. Verify it's really them: ask **"[control question]"**.
2. Agree a calm day. This takes an afternoon, not an hour.

## The steps (done together)

1. Clean computer, official wallet software, checksum verified — the helper knows.
2. Bring the hardware wallet from **[location]** — try it first; the seed backup stays where it is unless the device is dead.
3. If restoring from seed: **[location]**, and the passphrase from **[location]** if the balance looks empty.
4. Small test transaction first. Then, only when everything checks out, the rest — to an address verified on the device screen.

## If anything feels wrong

Stop. Nothing is lost by stopping. A wrong passphrase just shows an empty wallet — pause and re-check with the helper.`
      }
    ]
  },

  'dry-run': {
    title: 'Dry Run',
    group: 'Testing',
    guides: [
      {
        id: 'guide_dry_run_script',
        title: 'Dry run — the 45-minute script',
        content: `## The rule of the game

You are not there. Answer nothing. Every hint is a hole the real day will find. Take notes — every hesitation is a finding.

## Script

1. **Setup (5 min).** "If something happened to me tomorrow, I want to know you'd be okay. Pretend I'm not here." Give them only what they'd really have.
2. **Discovery (10 min).** Can they find the plan at all? If not — finding #1, stop kindly.
3. **Access (10 min).** Can they open it? Type-it-in know the password, not "I think so".
4. **Orientation (10 min).** First steps? Whom to call? What not to touch?
5. **One real task (10 min).** e.g. "find the insurance policy" or "how would you check the Bitcoin helper is really him?"

## Afterwards

- Record each check (done / not sure / couldn't) in Readiness — **no secrets in the notes**.
- Fix the top two findings this week. Only two — then it actually happens.
- Repeat yearly, or after any big change.`
      }
    ]
  },

  'trusted-helper-protocol': {
    title: 'Trusted-Helper Protocol',
    group: 'Safety',
    guides: [
      {
        id: 'guide_helpers',
        title: 'Who helps — and how to check it is really them',
        content: `## The helpers

- **First call**: [name] — calm, knows the plan exists. Job: be there, slow things down.
- **Technical helper (crypto)**: [name] — the ONLY person for anything Bitcoin. Job: guide recovery, never touch keys alone.
- **Professional**: [name, firm] — the legal path and deadlines.

## Verify before you trust

Ask the control question. Only the real person can answer:

- [Name]: **"[personal question only they know]"**
- [Name]: **"[personal question only they know]"**

## The four rules

1. **Nobody legitimate asks for seed words, passwords, or PINs.** The question itself is the scam.
2. **Whoever contacts YOU first is a stranger.** Real helpers are the ones named above.
3. **Urgency is the tell.** Anything that "must happen today" can wait a week.
4. **Two people for anything irreversible** — you plus one named helper, same room.

## If something already went wrong

Freeze what can be frozen, police report the same day, tell the first-call helper, change passwords from a different device. No shame — speed.`
      }
    ]
  }
};

/** The guides + group to seed into a fresh plan, or null. */
export function templateSeed(id) {
  const t = TEMPLATES[id];
  if (!t) return null;
  const groupId = 'grp_template';
  return {
    title: t.title,
    guide_groups: [{ id: groupId, name: t.group, order: 0 }],
    guides: t.guides.map((g, i) => ({
      id: g.id,
      title: g.title,
      group: groupId,
      order: i,
      content: { en: g.content }
    }))
  };
}
