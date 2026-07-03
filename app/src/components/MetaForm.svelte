<script>
  import EntityPicker from './EntityPicker.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import InfoHint from './InfoHint.svelte';
  import PassphraseField from './PassphraseField.svelte';
  import { MIN_PASSWORD_LENGTH } from '../lib/crypto.js';
  let { pkg, raw, store, requestConfirm = null, requestNotice = null } = $props(); // raw = data.package

  let newLang = $state('');

  // Draft-at-rest protection. `showProtect` opens the passphrase form both for
  // turning protection on and for changing the passphrase (same flow: derive a
  // fresh key + salt and rewrite everything).
  let showProtect = $state(false);
  let draftPass = $state('');
  let draftBusy = $state(false);
  let draftErr = $state('');

  async function applyProtection() {
    draftErr = '';
    if (draftPass.length < MIN_PASSWORD_LENGTH) {
      draftErr = `Use at least ${MIN_PASSWORD_LENGTH} characters — a 6-word passphrase is ideal.`;
      return;
    }
    draftBusy = true;
    try {
      await store.enableDraftProtection(draftPass);
      draftPass = '';
      showProtect = false;
    } catch (e) {
      draftErr = e?.message || String(e);
    } finally {
      draftBusy = false;
    }
  }

  async function turnOffProtection() {
    const ok = await requestConfirm?.({
      title: 'Turn off draft protection?',
      message: 'The working draft on this device will be stored unencrypted again. Your exported files are not affected.',
      confirmLabel: 'Turn off',
      tone: 'danger'
    });
    if (!ok) return;
    draftBusy = true;
    try {
      await store.disableDraftProtection();
      showProtect = false;
      draftPass = '';
    } finally {
      draftBusy = false;
    }
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
        <button class="mini" title="Add language" onclick={addLanguage}>+</button>
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
      <span class="lbl">Draft protection<InfoHint text="Encrypts the auto-saved draft on this device (the plan JSON and any files) with a passphrase. Protects a copied disk or profile — not a live-compromised browser or your unlocked screen. The encrypted export stays your durable backup." /></span>
      {#if store?.draftProtected && !showProtect}
        <p class="tiny protected-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          This draft is encrypted at rest on this device.
        </p>
        <div class="row" style="gap:8px">
          <button class="mini-btn" onclick={() => (showProtect = true)}>Change passphrase…</button>
          <button class="link-btn tiny" disabled={draftBusy} onclick={turnOffProtection}>Turn off protection</button>
        </div>
      {:else if !showProtect}
        <p class="tiny muted">The working draft is saved unencrypted on this device. You can lock it with a passphrase.</p>
        <button class="mini-btn" onclick={() => (showProtect = true)}>Protect this draft…</button>
      {:else}
        <PassphraseField bind:value={draftPass} placeholder={store?.draftProtected ? 'New draft passphrase' : 'Draft passphrase'} onEnter={applyProtection} />
        <p class="tiny muted">
          A <strong>6-word passphrase</strong> is far stronger than a short password and easy to write down.
          If you forget it, this draft can't be recovered — keep the encrypted export as your backup.
        </p>
        {#if draftErr}<p class="tiny" style="color: var(--warn)">{draftErr}</p>{/if}
        <div class="row" style="gap:8px">
          <button class="mini-btn" disabled={draftBusy || !draftPass} onclick={applyProtection}>{draftBusy ? 'Encrypting…' : store?.draftProtected ? 'Change passphrase' : 'Turn on'}</button>
          <button class="link-btn tiny" onclick={() => { showProtect = false; draftPass = ''; draftErr = ''; }}>Cancel</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .lang-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .protect { border-top: 1px solid var(--rule); padding-top: 14px; margin-top: 4px; display: flex; flex-direction: column; gap: 10px; }
  .protected-line { display: inline-flex; align-items: center; gap: 7px; color: var(--accent-deep); }
  .mini-btn { font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid var(--rule); border-radius: 0; background: var(--paper); color: var(--ink); cursor: pointer; }
  .mini-btn:hover { border-color: var(--accent-deep); }
  .mini-btn:disabled { opacity: 0.5; cursor: default; }
  .link-btn { background: none; border: none; color: var(--ink-mute); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
  .link-btn:disabled { opacity: 0.5; cursor: default; }
</style>
