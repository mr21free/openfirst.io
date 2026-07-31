<script>
  import EntityPicker from './EntityPicker.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import InfoHint from './InfoHint.svelte';
  import PassphraseField from './PassphraseField.svelte';
  import Callout from './Callout.svelte';
  import { estimateBits } from '../lib/passphrase.js';
  import { downloadReviewIcs, googleCalendarUrl } from '../lib/calendar.js';
  import { lockBodyScroll } from '../lib/scrollLock.js';
  let { pkg, raw, store, requestConfirm = null, requestNotice = null } = $props(); // raw = data.package

  let newLang = $state('');

  const PASSPHRASE_STRENGTH_HINT = 'A 6-word passphrase is far stronger than a short password and easy to write down. If you forget it, and no other slot knows it, this plan can’t be recovered — keep an encrypted export as your backup.';

  // Adding the first (or a further) passphrase slot.
  let showAdd = $state(false);
  let addLabel = $state('');
  let addHint = $state('');
  let addPass = $state('');
  let addPassConfirmed = $state(true);
  let addBusy = $state(false);
  let addErr = $state('');
  $effect(() => { addPass; addErr = ''; });

  function openAdd() {
    addLabel = '';
    addHint = '';
    addPass = '';
    addErr = '';
    showAdd = true;
  }

  async function submitAdd() {
    addErr = '';
    if (estimateBits(addPass) < 40) {
      addErr = 'That password is too weak — the strength meter above should read at least "Fair" before you continue.';
      return;
    }
    if (!addPassConfirmed) {
      addErr = 'Repeat the password below to confirm it — a forgotten plan password cannot be recovered.';
      return;
    }
    addBusy = true;
    try {
      if (store.protected) await store.addSlot(addPass, addLabel || 'Passphrase', addHint);
      else await store.protectPlan(addPass, addLabel || 'Passphrase', addHint);
      showAdd = false;
      addPass = '';
    } catch (e) {
      addErr = e?.message || String(e);
    } finally {
      addBusy = false;
    }
  }

  // Re-keying (changing) one existing slot in place.
  let rekeyId = $state(null);
  let rekeyLabel = $state('');
  let rekeyHint = $state('');
  let rekeyPass = $state('');
  let rekeyPassConfirmed = $state(true);
  let rekeyBusy = $state(false);
  let rekeyErr = $state('');
  $effect(() => { rekeyPass; rekeyErr = ''; });

  function startRekey(slot) {
    rekeyId = slot.id;
    rekeyLabel = slot.label || '';
    rekeyHint = slot.hint || '';
    rekeyPass = '';
    rekeyErr = '';
  }
  function cancelRekey() { rekeyId = null; rekeyPass = ''; rekeyErr = ''; }

  async function submitRekey() {
    rekeyErr = '';
    if (estimateBits(rekeyPass) < 40) {
      rekeyErr = 'That password is too weak — the strength meter above should read at least "Fair" before you continue.';
      return;
    }
    if (!rekeyPassConfirmed) {
      rekeyErr = 'Repeat the password below to confirm it — a forgotten plan password cannot be recovered.';
      return;
    }
    rekeyBusy = true;
    try {
      await store.rekeySlot(rekeyId, rekeyPass, rekeyLabel || 'Passphrase', rekeyHint);
      rekeyId = null;
      rekeyPass = '';
    } catch (e) {
      rekeyErr = e?.message || String(e);
    } finally {
      rekeyBusy = false;
    }
  }

  let removingId = $state(null);
  async function removeSlot(id) {
    const ok = await requestConfirm?.({
      title: 'Remove this passphrase?',
      message: 'Anyone who only knows this passphrase will no longer be able to open the plan.',
      confirmLabel: 'Remove',
      tone: 'danger'
    });
    if (!ok) return;
    removingId = id;
    try {
      await store.removeSlot(id);
    } finally {
      removingId = null;
    }
  }

  // Review reminder — a calendar file the owner sets up from here, whenever
  // they're already in Settings. No auto popup anywhere; opening this row is
  // the opt-in, so it goes straight to the picker (no "ask first" step) —
  // shown as its own modal, same as the rest of the app's dialogs.
  let reminderOpen = $state(false);
  let reminderMonths = $state(6);
  let reminderWeekday = $state(6); // Saturday — a relaxed day
  let reminderHour = $state(9);    // morning
  const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

  $effect(() => { if (reminderOpen) return lockBodyScroll(); });

  // Capture-phase so Escape closes only this modal, not the Settings drawer
  // underneath it (same pattern as Reader.svelte's showNewMenu popover).
  $effect(() => {
    if (!reminderOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); reminderOpen = false; } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function toCal(provider) {
    const opts = { months: reminderMonths, weekday: reminderWeekday, hour: reminderHour, title: raw.title?.trim() || '' };
    if (provider === 'google') window.open(googleCalendarUrl(opts), '_blank', 'noopener,noreferrer');
    else downloadReviewIcs(opts);
  }

  function addLanguage() {
    if (store?.addLanguage(newLang)) newLang = '';
  }

  async function deleteLanguage(lang) {
    if ((raw.languages || []).length <= 1) {
      await requestNotice?.({
        title: 'Keep one language',
        message: 'Keep at least one language in the plan.'
      });
      return;
    }
    const affected = (store?.data?.guides || []).filter((g) => g.content?.[lang]).length;
    const ok = await requestConfirm?.({
      title: `Delete '${lang.toUpperCase()}' language?`,
      message: `This will delete the ${lang.toUpperCase()} version from ${affected} guide${affected === 1 ? '' : 's'}. This cannot be undone here.`
    });
    if (!ok) return;
    store?.deleteLanguage(lang);
  }
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Plan title</span><input bind:value={raw.title} placeholder="e.g. Inheritance plan of …" /></label>
    <div class="f"><span class="lbl">Plan owner<InfoHint text="The person who prepared this plan. This name is shown on the opening screen for readers." /></span>
      <EntityPicker {pkg} target={raw} key="owner_id" kinds={['person']} single placeholder="Choose plan owner…" />
    </div>
    <div class="f">
      <span class="lbl">Languages</span>
      <div class="lang-list">
        {#each raw.languages || ['en'] as l}
          <span class="pchip">
            <span>{l.toUpperCase()}</span>
            <button class="x" title="Delete" aria-label={`Delete ${l.toUpperCase()}`} onclick={() => deleteLanguage(l)}><TrashIcon size={11} /></button>
          </span>
        {/each}
      </div>
      <div class="row-add">
        <input bind:value={newLang} placeholder="e.g. sk" onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addLanguage())} />
        <button class="iconbtn" data-tip="Add language" aria-label="Add language" onclick={addLanguage}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></button>
      </div>
    </div>
    <label class="f"><span class="lbl">Default language</span>
      <select bind:value={raw.default_language}>{#each raw.languages || ['en'] as l}<option value={l}>{l.toUpperCase()}</option>{/each}</select>
    </label>
    <label class="f"><span class="lbl">Theme</span>
      <select value={raw.theme || 'light'} onchange={(e) => (raw.theme = e.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">Match device</option>
      </select>
    </label>
    <label class="f"><span class="lbl">Guide font<InfoHint text="The typeface for your guide text. It travels with the plan, so your heir reads the guides in the very same face." /></span>
      <select value={raw.reading_font || 'mono'} onchange={(e) => (raw.reading_font = e.target.value)}>
        <optgroup label="Monospace">
          <option value="mono">IBM Plex Mono — calm, technical</option>
        </optgroup>
        <optgroup label="Sans-serif">
          <option value="sans">IBM Plex Sans — clean, modern</option>
          <option value="inter">Inter — neutral, screen-friendly</option>
          <option value="atkinson">Atkinson Hyperlegible — maximum legibility</option>
        </optgroup>
        <optgroup label="Serif">
          <option value="serif">Source Serif — warm, contemporary</option>
          <option value="literata">Literata — book / e-reader</option>
          <option value="lora">Lora — classic, calligraphic</option>
        </optgroup>
      </select>
    </label>
    <div class="f"><span class="lbl">Primary recipients<InfoHint text="The people this plan is mainly for. They appear first — above a divider — wherever you pick who's reading." /></span>
      <EntityPicker {pkg} target={raw} key="primary_person_ids" kinds={['person']} placeholder="Add a recipient…" />
    </div>

    <div class="f protect">
      <div class="protect-row">
        <span class="protect-ico" class:active={store?.protected} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </span>
        <div class="protect-main">
          <span class="lbl" style="margin:0">Plan protection<InfoHint text="Encrypts the plan (and any files) with one or more passphrases — any one of them opens it. Protects a copied disk, browser profile, or the saved file itself; not a live-compromised browser or your unlocked screen." /></span>
          <p class="tiny muted protect-desc">
            {#if store?.protected}This plan is encrypted — {store.slots.length} passphrase{store.slots.length === 1 ? '' : 's'} can open it.
            {:else}The plan in progress is saved unencrypted, in this browser and in any exported file.{/if}
          </p>
        </div>
      </div>

      {#if store?.protected}
        <ul class="slot-list">
          {#each store.slots as slot (slot.id)}
            <li class="slot-row">
              {#if rekeyId === slot.id}
                <div class="protect-form">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="slot-label-input" bind:value={rekeyLabel} placeholder="Label (e.g. 'For my spouse')" autofocus />
                  <input class="slot-hint-input" bind:value={rekeyHint} placeholder="Hint (optional)" />
                  <PassphraseField
                    bind:value={rekeyPass}
                    bind:confirmOk={rekeyPassConfirmed}
                    placeholder="New passphrase"
                    onEnter={submitRekey}
                    strengthHint={PASSPHRASE_STRENGTH_HINT}
                  />
                  {#if rekeyErr}<Callout text={rekeyErr} />{/if}
                  <div class="row" style="gap:8px; justify-content: flex-end">
                    <button class="btn btn-small btn-ghost" onclick={cancelRekey}>Cancel</button>
                    <button class="btn btn-small btn-primary" disabled={rekeyBusy || !rekeyPass} onclick={submitRekey}>{rekeyBusy ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              {:else}
                <span class="slot-ico" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </span>
                <div class="slot-main">
                  <span class="slot-label">{slot.label || 'Passphrase'}</span>
                  {#if slot.hint}<span class="slot-hint">hint: {slot.hint}</span>{/if}
                </div>
                <div class="slot-actions">
                  <button
                    class="iconbtn"
                    data-tip="Change this passphrase"
                    data-tip-pos="left"
                    aria-label="Change this passphrase"
                    onclick={() => startRekey(slot)}
                  ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                  <button
                    class="iconbtn danger"
                    disabled={removingId === slot.id}
                    data-tip="Remove this passphrase"
                    data-tip-pos="left"
                    aria-label="Remove this passphrase"
                    onclick={() => removeSlot(slot.id)}
                  ><TrashIcon size={13} /></button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if showAdd}
        <div class="protect-form">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="slot-label-input" bind:value={addLabel} placeholder="Label (e.g. 'For my spouse')" autofocus />
          <input class="slot-hint-input" bind:value={addHint} placeholder="Hint (optional)" />
          <PassphraseField
            bind:value={addPass}
            bind:confirmOk={addPassConfirmed}
            placeholder="Passphrase"
            onEnter={submitAdd}
            strengthHint={PASSPHRASE_STRENGTH_HINT}
          />
          {#if addErr}<Callout text={addErr} />{/if}
          <div class="row" style="gap:8px; justify-content: flex-end">
            <button class="btn btn-small btn-ghost" onclick={() => (showAdd = false)}>Cancel</button>
            <button class="btn btn-small btn-primary" disabled={addBusy || !addPass} onclick={submitAdd}>{addBusy ? 'Encrypting…' : 'Add'}</button>
          </div>
        </div>
      {:else if rekeyId === null}
        <button class="btn btn-small btn-primary add-slot-btn" onclick={openAdd}>+ Add a passphrase</button>
      {/if}
    </div>

    <div class="f protect">
      <div class="protect-row">
        <span class="protect-ico" class:active={reminderOpen} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
        </span>
        <div class="protect-main">
          <span class="lbl" style="margin:0">Review reminder<InfoHint text="A calendar file you add once — your own calendar then reminds you to revisit this plan on the cadence you pick." /></span>
          <p class="tiny muted protect-desc">Set up a recurring reminder to revisit and update this plan.</p>
        </div>
      </div>

      <button class="btn btn-small btn-primary add-slot-btn" onclick={() => (reminderOpen = true)}>Set up a reminder</button>
    </div>
  </div>
{/if}

{#if reminderOpen}
  <div class="rem-scrim" role="presentation" onclick={() => (reminderOpen = false)}></div>
  <div class="rem-modal" role="dialog" aria-modal="true" aria-label="Set a review reminder" tabindex="-1">
    <span class="eyebrow">Reminder</span>
    <h3>When should we remind you?</h3>

    <div class="rem-row">
      <label class="rem-field"><span class="rem-lbl">Every</span>
        <select bind:value={reminderMonths}>
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">on a</span>
        <select bind:value={reminderWeekday}>
          {#each WEEKDAYS as [v, label]}<option value={v}>{label}</option>{/each}
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">in the</span>
        <select bind:value={reminderHour}>
          <option value={9}>morning</option>
          <option value={13}>afternoon</option>
          <option value={19}>evening</option>
        </select>
      </label>
    </div>
    <div class="rem-providers">
      <span class="rem-lbl">Add to:</span>
      <div class="rem-provider-row">
        <button class="btn btn-small" type="button" onclick={() => toCal('apple')} title="Apple Calendar / iCloud">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M17.05 12.7c-.03-2.4 1.96-3.55 2.05-3.6-1.12-1.64-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.62.02-3.11.94-3.94 2.39-1.68 2.92-.43 7.24 1.2 9.61.8 1.16 1.75 2.46 3 2.41 1.2-.05 1.66-.78 3.11-.78 1.45 0 1.86.78 3.13.75 1.29-.02 2.11-1.18 2.9-2.35.91-1.35 1.29-2.65 1.31-2.72-.03-.01-2.51-.96-2.54-3.81zM14.69 5.6c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.63-2.8 1.43-.61.71-1.15 1.84-1 2.93 1.06.08 2.14-.54 2.81-1.33z" /></svg>
          Apple
        </button>
        <button class="btn btn-small" type="button" onclick={() => toCal('google')} title="Google Calendar (opens online)">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
          Google
        </button>
        <button class="btn btn-small" type="button" onclick={() => toCal('outlook')} title="Outlook">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022" /><rect x="13" y="1" width="10" height="10" fill="#7FBA00" /><rect x="1" y="13" width="10" height="10" fill="#00A4EF" /><rect x="13" y="13" width="10" height="10" fill="#FFB900" /></svg>
          Outlook
        </button>
        <button class="btn btn-small" type="button" onclick={() => toCal('other')}>Other (.ics)</button>
      </div>
    </div>
    <div class="row" style="justify-content: flex-end; margin-top: 8px">
      <button class="btn btn-small btn-primary" onclick={() => (reminderOpen = false)}>Close</button>
    </div>
  </div>
{/if}

<style>
  .lang-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .protect { border-top: 1px solid var(--rule); padding-top: 14px; margin-top: 4px; display: flex; flex-direction: column; gap: 12px; }
  .protect-row { display: flex; align-items: flex-start; gap: 12px; }
  .protect-ico {
    flex: none; width: 30px; height: 30px; margin-top: 1px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--accent-wash); color: var(--ink-mute);
  }
  .protect-ico.active { color: var(--accent-deep); }
  .protect-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .protect-desc { margin: 0; }
  .protect-form { display: flex; flex-direction: column; gap: 10px; }
  /* Unified-list look: same row pattern as People/Roles/Items in the reader
     (hairline rule between rows, no per-row box) — but unlike those rows,
     a slot row has no click-through of its own (only its icon buttons are
     actionable), so it skips their hover wash rather than implying a click
     that isn't there. */
  .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .slot-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; border-top: 1px solid var(--rule-soft);
  }
  .slot-row:last-of-type { border-bottom: 1px solid var(--rule-soft); }
  /* As the row's only flex child, the rekey form would otherwise shrink to
     its content's width instead of filling the row. */
  .slot-row > .protect-form { width: 100%; }
  .slot-ico { flex: none; display: inline-flex; color: var(--ink-mute); }
  .slot-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .slot-label { font-size: 14px; }
  .slot-hint { font-family: var(--mono); font-size: 12.5px; color: var(--ink-mute); }
  .slot-actions { display: flex; gap: 4px; flex: none; }
  .add-slot-btn { align-self: flex-start; }

  .rem-scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .rem-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal); width: min(480px, 94vw);
    background: var(--paper); border: 1px solid var(--rule); border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.18);
    padding: 30px 32px;
    max-height: 92vh; overflow-y: auto;
  }
  .rem-modal h3 { font-size: 19px; }
  .rem-row { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; }
  .rem-field { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; }
  .rem-lbl { color: var(--ink-mute); }
  .rem-field select {
    appearance: none; -webkit-appearance: none;
    font: inherit; font-size: 12.5px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 6px 22px 6px 8px;
    background: var(--paper) no-repeat right 6px center;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23667788' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-size: 9px;
  }
  .rem-field select:focus { outline: none; border-color: var(--accent-deep); }
  .rem-providers { display: flex; flex-direction: column; gap: 8px; }
  .rem-provider-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  @media (max-width: 480px) {
    .rem-row { flex-direction: column; align-items: stretch; gap: 8px; }
    .rem-field { width: 100%; }
    .rem-field .rem-lbl { flex: none; width: 50px; text-align: right; }
    .rem-field select { flex: 1; min-width: 0; }
  }
</style>
