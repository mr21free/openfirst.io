<script>
  import { untrack } from 'svelte';
  import { exportPackageZip, exportEncryptedPackage, exportSelfContainedReader, draftCount } from '../lib/export.js';
  import { estimateBits } from '../lib/passphrase.js';
  import { lockBodyScroll } from '../lib/scrollLock.js';
  import PassphraseField from './PassphraseField.svelte';
  import Callout from './Callout.svelte';
  import InfoHint from './InfoHint.svelte';
  import ReviewReminderDialog from './ReviewReminderDialog.svelte';

  let { data, blobs, onClose } = $props();

  $effect(() => lockBodyScroll());

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

  // After a successful export, offer the review reminder as its own follow-up
  // step rather than one more thing to configure before saving.
  let showReminder = $state(false);

  const datePart = new Date().toISOString().slice(0, 10);
  const slug = $derived((name || 'life-package').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'life-package');
  const fileName = $derived(
    asReader
      ? `${slug}_${datePart}_start-here.html`
      : `${slug}_${datePart}` + (protect ? '.encrypted.json' : '.zip')
  );

  async function doExport() {
    error = '';
    if (protect && estimateBits(password) < 40) {
      error = 'That password is too weak — the strength meter above should read at least "Fair" before you continue.';
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
      showReminder = true;
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose?.()} />
{#if showReminder}
  <ReviewReminderDialog {name} {fileName} onClose={() => onClose?.()} />
{:else}
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
  </label>
  {#if asReader}<p class="size-note tiny muted">export will be ~{estMb} MB</p>{/if}
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
      <PassphraseField
        bind:value={password}
        bind:confirmOk={passwordConfirmed}
        onEnter={doExport}
        strengthHint="A 6-word passphrase is far stronger than a short password and easy to write down. The file is encrypted with AES-256-GCM — without the password it reveals nothing and can't be recovered."
      />

      <div class="hint-field">
        <input class="inp" type="text" bind:value={hint} placeholder="Password hint (optional)" />
        <InfoHint text={'Stored in plain text — use a pointer like "ask Jan", never the password itself.'} label="About the password hint" pos="left" />
      </div>
    </div>
  {/if}

  {#if error}<Callout text={error} />{/if}

  <div class="row" style="gap:10px; margin-top:6px">
    <button class="btn btn-primary" onclick={doExport} disabled={busy}>
      {busy ? 'Working…' : 'Export'}
    </button>
    <button class="btn btn-ghost" onclick={() => onClose?.()}>Cancel</button>
  </div>
</div>
{/if}

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
  /* overflow-wrap (not word-break: break-all) — it only breaks mid-word as a
     last resort, so a long filename wraps after a hyphen/underscore instead
     of splitting a word like "html" into "htm" + "l". */
  .namefield code { background: var(--accent-wash); padding: 0 4px; border-radius: 4px; overflow-wrap: break-word; }
  .toggle { display: inline-flex; align-items: center; gap: 9px; font-size: 14px; cursor: pointer; }
  .pw-block { display: flex; flex-direction: column; gap: 10px; }
  .inp {
    flex: 1; font: inherit; font-size: 14px; color: var(--ink);
    border: 1px solid var(--rule); border-radius: 0; padding: 10px 12px; background: var(--paper);
  }
  .inp:focus { outline: none; border-color: var(--accent-deep); }
  /* Strength bar + label row, with the suggest link on the right */
  .pw-gen-link:hover { color: var(--ink); }
  .hint-field { display: flex; align-items: center; }
  .reader-note, .size-note { margin: -6px 0 0 27px; color: var(--ink-mute); }
</style>
