<script>
  import EntityPicker from './EntityPicker.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import GuideContentEditor from './GuideContentEditor.svelte';
  let { pkg, raw, onDelete } = $props();

  const CONTACT_METHODS = ['email', 'phone', 'signal', 'whatsapp', 'telegram', 'linkedin', 'address', 'url', 'other'];

  const shownRoles = $derived(pkg.roles || []);

  let firstInput = $state(null);
  $effect(() => { if (firstInput) firstInput.focus(); });

  function toggleRole(roleId) {
    if (!Array.isArray(raw.roles)) raw.roles = [];
    const i = raw.roles.indexOf(roleId);
    if (i >= 0) raw.roles.splice(i, 1); else raw.roles.push(roleId);
  }

  function addContact() { if (!Array.isArray(raw.contacts)) raw.contacts = []; raw.contacts.push({ method: 'email', value: '' }); }
  function removeContact(i) { raw.contacts.splice(i, 1); }
  function addVerification() { raw.verification = { question: '', answer_hint: '' }; }
</script>

{#if raw}
  <div class="frm">
    <div class="grid2">
      <label class="f"><span class="lbl">Full / legal name</span><input bind:this={firstInput} bind:value={raw.name} placeholder="e.g. John James" /></label>
      <label class="f"><span class="lbl">Nickname</span><input bind:value={raw.nickname} placeholder="e.g. Johny" /></label>
    </div>
    <label class="f"><span class="lbl">Known as</span><input bind:value={raw.display_as} placeholder="e.g. my partner" /></label>
    <div class="f"><span class="lbl">Notes</span>
      <GuideContentEditor {pkg} {raw} compact value={raw.notes || ''} onValue={(v) => (raw.notes = v)} placeholder={'Notes — format text, or type “@” to mention a person, item or location.'} />
    </div>

    <div class="f">
      <span class="lbl">Role</span>
      <div class="roles">
        {#each shownRoles as role}
          <label class="tagchip" class:on={(raw.roles || []).includes(role.id)}>
            <input type="checkbox" checked={(raw.roles || []).includes(role.id)} onchange={() => toggleRole(role.id)} />
            {role.name}
          </label>
        {/each}
      </div>
    </div>
    <label class="f"><span class="lbl">Readiness score</span><input bind:value={raw.readiness_score} placeholder="e.g. Ready, 80%, needs another dry run" /></label>

    <div class="f"><span class="lbl">Can access (items)</span>
      <EntityPicker {pkg} target={raw} reverse reverseKey="access_person_ids" kinds={['item']} placeholder="Add an item they can access…" />
    </div>

    <div class="f">
      <span class="lbl">Contact information</span>
      {#each raw.contacts || [] as c, i}
        <div class="row-add">
          <select bind:value={c.method}>{#each CONTACT_METHODS as m}<option value={m}>{m}</option>{/each}</select>
          <input bind:value={c.value} placeholder="value" />
          <button class="mini" title="Delete" onclick={() => removeContact(i)}><TrashIcon size={12} /></button>
        </div>
      {/each}
      <button class="addbtn" onclick={addContact}>+ Add contact</button>
    </div>

    <div class="f">
      <span class="lbl">Identity check (anti-scam)</span>
      {#if raw.verification}
        <input bind:value={raw.verification.question} placeholder="Control question only they know" />
        <input bind:value={raw.verification.answer_hint} placeholder="Expected answer / hint" />
        <button class="addbtn" onclick={() => delete raw.verification}>Delete</button>
      {:else}
        <button class="addbtn" onclick={addVerification}>+ Add a control question</button>
      {/if}
    </div>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}

<style>
  .roles { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
