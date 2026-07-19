<script>
  /*
    Shown after an export completes — a separate step (not a checkbox buried in
    the export form) so it reads as "you're done, now here's an optional
    follow-up" rather than one more thing to configure before saving.
  */
  import { downloadReviewIcs, googleCalendarUrl } from '../lib/calendar.js';
  import { lockBodyScroll } from '../lib/scrollLock.js';
  import Callout from './Callout.svelte';

  let { name = '', fileName = '', onClose } = $props();

  $effect(() => lockBodyScroll());

  // Ask first, show the cadence/calendar picker only once they opt in — the
  // full setup is a lot to read right after "your export is done."
  let expanded = $state(false);

  let months = $state(6);
  let weekday = $state(6); // Saturday — a relaxed day
  let hour = $state(9);    // morning
  const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

  // Picking a calendar IS the final action here — no separate "Done" button.
  // Google has an "add event" web link that carries the repeat; Apple/Outlook/etc.
  // open the universal .ics file (it keeps the repeat too).
  function toCal(provider) {
    const opts = { months, weekday, hour, title: name.trim() };
    if (provider === 'google') window.open(googleCalendarUrl(opts), '_blank', 'noopener,noreferrer');
    else downloadReviewIcs(opts);
    onClose?.();
  }

  function onKeydown(e) { if (e.key === 'Escape') onClose?.(); }
</script>

<svelte:window onkeydown={onKeydown} />
<div class="scrim" role="presentation" onclick={() => onClose?.()}></div>
<div class="modal card" role="dialog" aria-modal="true" aria-label="Set a review reminder" tabindex="-1">
  {#if !expanded}
    <span class="eyebrow">Saved</span>
    <Callout tone="success" text={fileName ? `Exported ${fileName}` : 'Exported successfully.'} />
    <h3>Set a review reminder?</h3>
    <p class="tiny muted rem-lede">A calendar file you import once — your own calendar then reminds you to revisit and re-export.</p>

    <div class="row" style="gap:10px; margin-top:6px; justify-content:flex-end">
      <button class="btn btn-ghost" onclick={() => onClose?.()}>No thanks</button>
      <button class="btn btn-primary" onclick={() => (expanded = true)}>Set up a reminder</button>
    </div>
  {:else}
    <span class="eyebrow">Reminder</span>
    <h3>When should we remind you?</h3>

    <div class="rem-row">
      <label class="rem-field"><span class="rem-lbl">Every</span>
        <select bind:value={months}>
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">on a</span>
        <select bind:value={weekday}>
          {#each WEEKDAYS as [v, label]}<option value={v}>{label}</option>{/each}
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">in the</span>
        <select bind:value={hour}>
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
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal); width: min(480px, 94vw);
    border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.18);
    padding: 30px 32px;
    max-height: 92vh; overflow-y: auto;
  }
  .modal h3 { font-size: 19px; }
  .rem-lede { margin: 0; }
  .rem-row { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; }
  .rem-field { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; }
  .rem-lbl { color: var(--ink-mute); }
  /* Same inset chevron as .frm select — not jammed to the box's edge. */
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

  /* Three fields side by side no longer fit past this width (the third
     dropdown runs off the modal's edge) — stack them instead, one per line.
     A fixed-width, right-aligned label column keeps every dropdown starting
     at the same x, so the stack still reads as one aligned form. */
  @media (max-width: 480px) {
    .rem-row { flex-direction: column; align-items: stretch; gap: 8px; }
    .rem-field { width: 100%; }
    /* Scoped to .rem-field's own label ("Every", "on a", "in the") — the bare
       .rem-lbl selector used to also catch the "Add to:" label below, forcing
       it into the same 50px column and wrapping it onto two lines. */
    .rem-field .rem-lbl { flex: none; width: 50px; text-align: right; }
    /* The label column is fixed-width, but the select itself was sized to its
       own content — each dropdown started at the same x but ended wherever
       its own text stopped. flex:1 stretches every select to the same right
       edge, so the three read as one aligned column, not three ragged ones. */
    .rem-field select { flex: 1; min-width: 0; }
  }
</style>
