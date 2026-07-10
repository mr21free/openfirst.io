<script>
  import { untrack } from 'svelte';
  import { exportPackageZip, exportEncryptedPackage, exportSelfContainedReader, draftCount } from '../lib/export.js';
  import { MIN_PASSWORD_LENGTH } from '../lib/crypto.js';
  import { downloadReviewIcs, googleCalendarUrl } from '../lib/calendar.js';
  import PassphraseField from './PassphraseField.svelte';

  let { data, blobs, onClose } = $props();

  let name = $state(untrack(() => data.package?.title) || 'My plan');
  let asReader = $state(true);
  let protect = $state(false);
  let password = $state('');
  let passwordConfirmed = $state(true);
  let hint = $state('');
  let busy = $state(false);
  let error = $state('');

  const drafts = $derived(draftCount(data));

  // Rough size of what's about to be written: attachments (+33% when base64'd
  // into the one-file reader) plus the ~1.2 MB reader shell. Past ~50 MB a
  // single HTML file gets unwieldy — steer to the .zip package.
  const attachmentBytes = $derived.by(() => {
    let bytes = 0;
    for (const a of data?.attachments || []) bytes += blobs?.get?.(a.id)?.size || 0;
    return bytes;
  });
  const estBytes = $derived(asReader ? Math.round(attachmentBytes * (4 / 3) + 1.2 * 1024 * 1024) : attachmentBytes);
  const estMb = $derived((estBytes / (1024 * 1024)).toFixed(estBytes > 10 * 1024 * 1024 ? 0 : 1));
  const tooBig = $derived(asReader && estBytes > 50 * 1024 * 1024);

  // Review reminder (.ics): user picks cadence + when; their calendar does the rest.
  let remind = $state(false);
  let remMonths = $state(3);
  let remWeekday = $state(6); // Saturday — a relaxed day
  let remHour = $state(9);    // morning
  let remNote = $state('');
  let remTimer;
  const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];
  // Google has an "add event" web link that carries the repeat; Apple/Outlook/etc.
  // open the universal .ics file (it keeps the repeat too).
  function toCal(provider) {
    const opts = { months: remMonths, weekday: remWeekday, hour: remHour, title: name.trim() };
    if (provider === 'google') {
      window.open(googleCalendarUrl(opts), '_blank', 'noopener,noreferrer');
      remNote = 'Opening Google Calendar in a new tab — press Save there.';
    } else {
      downloadReviewIcs(opts);
      remNote = provider === 'apple' ? 'Downloaded — double-click it to add it to Apple Calendar.'
        : provider === 'outlook' ? 'Downloaded — open / import the file into Outlook (the repeat is included).'
        : 'Downloaded life-plan-review-reminder.ics — open it in your calendar app.';
    }
    clearTimeout(remTimer);
    remTimer = setTimeout(() => (remNote = ''), 7000);
  }

  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = $derived(
    asReader
      ? 'start-here.html'
      : ((name || 'life-package').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'life-package') +
          '_' + datePart + (protect ? '.encrypted.json' : '.zip')
  );

  async function doExport() {
    error = '';
    if (protect && password.length < MIN_PASSWORD_LENGTH) {
      error = `Use at least ${MIN_PASSWORD_LENGTH} characters (a short passphrase is ideal).`;
      return;
    }
    if (protect && !passwordConfirmed) {
      error = 'Repeat the password below to confirm it — this file can never be recovered without it.';
      return;
    }
    busy = true;
    try {
      const n = name.trim();
      if (n && data.package) data.package.title = n; // the saved package takes this name
      if (asReader) await exportSelfContainedReader(data, blobs, { password: protect ? password : '', hint: hint.trim(), name: n });
      else if (protect) await exportEncryptedPackage(data, blobs, password, hint.trim(), n);
      else await exportPackageZip(data, blobs, n);
      onClose?.();
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose?.()} />
<div class="scrim" role="presentation" onclick={() => onClose?.()}></div>
<div class="modal card" role="dialog" aria-modal="true" aria-label="Export plan" tabindex="-1">
  <span class="eyebrow">Export</span>
  <h3>Save a copy to disk</h3>
  <p class="soft small">
    Downloads the plan to keep on a USB key or drive.
  </p>

  <div class="f namefield">
    <span class="lbl">Plan name</span>
    <input class="inp" bind:value={name} placeholder="My plan" />
    <span class="tiny muted">Saves as <code>{fileName}</code></span>
  </div>

  <label class="toggle">
    <input type="checkbox" bind:checked={asReader} />
    <span>Self-contained reader</span>
    {#if asReader}<span class="tiny muted">— export will be ~{estMb} MB</span>{/if}
  </label>
  {#if asReader && drafts > 0}
    <p class="reader-note tiny muted">{drafts} draft {drafts === 1 ? 'guide is' : 'guides are'} not included.</p>
  {/if}
  {#if tooBig}
    <p class="reader-note tiny" style="color: var(--warn)">
      A one-file reader this large can open slowly (or fail) on some computers.
      Consider the .zip package instead — it keeps files separate and stays fast at any size.
    </p>
  {/if}

  <label class="toggle">
    <input type="checkbox" bind:checked={protect} />
    <span>Protect with a password</span>
  </label>

  {#if protect}
    <div class="pw-block">
      <PassphraseField bind:value={password} bind:confirmOk={passwordConfirmed} onEnter={doExport} />

      <p class="tiny muted">
        A <strong>6-word passphrase</strong> is far stronger than a short password and easy to write down. The file
        is encrypted with AES-256-GCM — without the password it reveals nothing and can't be recovered.
      </p>

      <input class="inp" type="text" bind:value={hint} placeholder="Password hint (optional)" />
      <p class="tiny muted hint-note">Stored in plain text — use a pointer like “ask Jan”, never the password itself.</p>
    </div>
  {/if}

  {#if error}<p class="error small">{error}</p>{/if}

  <label class="toggle">
    <input type="checkbox" bind:checked={remind} />
    <span>Set a review reminder</span>
  </label>

  {#if remind}
  <section class="rem">
    <p class="tiny muted rem-lede">A calendar file you import once — your own calendar then reminds you to revisit and re-export. Nothing is sent anywhere; it works on every device.</p>
    <div class="rem-row">
      <label class="rem-field"><span class="rem-lbl">Every</span>
        <select bind:value={remMonths}>
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">on a</span>
        <select bind:value={remWeekday}>
          {#each WEEKDAYS as [v, label]}<option value={v}>{label}</option>{/each}
        </select>
      </label>
      <label class="rem-field"><span class="rem-lbl">in the</span>
        <select bind:value={remHour}>
          <option value={9}>morning</option>
          <option value={13}>afternoon</option>
          <option value={19}>evening</option>
        </select>
      </label>
    </div>
    <div class="rem-providers">
      <span class="rem-lbl">Add to</span>
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
      <button class="cal-link" type="button" onclick={() => toCal('other')}>Other (.ics)</button>
    </div>
    {#if remNote}<p class="rem-note tiny">{remNote}</p>{/if}
  </section>
  {/if}

  <div class="row" style="gap:10px; margin-top:6px">
    <button class="btn btn-primary" onclick={doExport} disabled={busy}>
      {busy ? 'Working…' : asReader ? 'Create reader' : protect ? 'Export protected' : 'Export'}
    </button>
    <button class="btn btn-ghost" onclick={() => onClose?.()}>Cancel</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal); width: min(580px, 94vw);
    border-left: 2px solid var(--accent);
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.18);
    padding: 30px 32px; /* dialogs get more air than inline cards */
    max-height: 92vh; overflow-y: auto;
  }
  .modal h3 { font-size: 19px; }
  .namefield { display: flex; flex-direction: column; gap: 6px; }
  .nlbl { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-mute); }
  .namefield code { background: var(--accent-wash); padding: 0 4px; border-radius: 4px; word-break: break-all; }
  .toggle { display: inline-flex; align-items: center; gap: 9px; font-size: 14px; cursor: pointer; }
  .pw-block { display: flex; flex-direction: column; gap: 10px; }
  .inp {
    flex: 1; font: inherit; font-size: 14px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 10px 12px; background: var(--paper);
  }
  .inp:focus { outline: none; border-color: var(--accent-deep); }
  .error { color: var(--warn); }
  /* Strength bar + label row, with the suggest link on the right */
  .pw-gen-link:hover { color: var(--ink); }
  .hint-note { margin-top: -4px; }
  .reader-note { margin: -6px 0 0 27px; color: var(--ink-mute); }
  /* Review reminder */
  .rem { display: flex; flex-direction: column; gap: 9px; padding: 13px 14px; border: 1px solid var(--rule-soft); border-left: 2px solid var(--accent); border-radius: var(--radius); background: color-mix(in oklch, var(--accent-wash) 30%, var(--paper)); }
  .rem-lede { margin: 0; }
  .rem-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .rem-field { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-soft); }
  .rem-lbl { color: var(--ink-mute); }
  .rem-field select { font: inherit; font-size: 13px; color: var(--ink); border: 1px solid var(--rule); border-radius: 0; padding: 6px 8px; background: var(--paper); }
  .rem-field select:focus { outline: none; border-color: var(--accent-deep); }
  .rem-providers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cal-link { font: inherit; font-size: 12.5px; color: var(--ink-mute); padding: 6px 4px; background: none; cursor: pointer; }
  .cal-link:hover { color: var(--ink); }
  .rem-note { color: var(--accent-deep); margin: 0; }
</style>
