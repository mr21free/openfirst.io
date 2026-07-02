<script>
  import EntityPicker from './EntityPicker.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import InfoHint from './InfoHint.svelte';
  let { pkg, raw, store, requestConfirm = null, requestNotice = null } = $props(); // raw = data.package

  let newLang = $state('');

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
  </div>
{/if}

<style>
  .lang-list { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
