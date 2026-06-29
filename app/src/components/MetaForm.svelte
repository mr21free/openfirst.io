<script>
  import EntityPicker from './EntityPicker.svelte';
  import TrashIcon from './TrashIcon.svelte';
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
    <label class="f"><span class="lbl">Appearance</span>
      <select value={raw.theme || 'light'} onchange={(e) => (raw.theme = e.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">Match device</option>
      </select>
    </label>
    <div class="f"><span class="lbl">Primary recipients</span>
      <span class="hint">The people this plan is mainly for. They appear first — above a divider — wherever you pick who's reading.</span>
      <EntityPicker {pkg} target={raw} key="primary_person_ids" kinds={['person']} placeholder="Add a recipient…" />
    </div>
  </div>
{/if}

<style>
  .lang-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .hint { display: block; font-size: 12px; color: var(--ink-mute); margin: -2px 0 7px; line-height: 1.5; }
</style>
