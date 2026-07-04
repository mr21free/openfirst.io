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

  // ---- Access path: the ordered physical journey to the plan ----
  const steps = $derived(raw?.access_path?.steps || []);
  function addStep() {
    if (!raw.access_path) raw.access_path = { steps: [] };
    if (!Array.isArray(raw.access_path.steps)) raw.access_path.steps = [];
    raw.access_path.steps.push({ id: 'st_' + Math.random().toString(36).slice(2, 8), text: '' });
  }
  function removeStep(i) {
    raw.access_path.steps.splice(i, 1);
    if (!raw.access_path.steps.length) delete raw.access_path;
  }
  function moveStep(i, dir) {
    const a = raw.access_path.steps;
    const j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
  }
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

    <div class="f">
      <span class="lbl">Access path</span>
      <p class="tiny muted" style="margin:0 0 4px">The physical journey to this plan, step by step — “open the safe”, “take the envelope”, “plug in the USB”. It becomes their first screen, and prints as the envelope insert. Pointers only, never the secrets themselves.</p>
      {#each steps as st, i (st.id)}
        <div class="step">
          <div class="step-head">
            <span class="step-num">{i + 1}</span>
            <span class="spacer"></span>
            <button class="iconbtn step-tool" data-tip="Move up" aria-label="Move up" disabled={i === 0} onclick={() => moveStep(i, -1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg></button>
            <button class="iconbtn step-tool" data-tip="Move down" aria-label="Move down" disabled={i === steps.length - 1} onclick={() => moveStep(i, 1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg></button>
            <button class="iconbtn danger step-tool" data-tip="Remove step" aria-label="Remove step" onclick={() => removeStep(i)}><TrashIcon size={13} /></button>
          </div>
          <input bind:value={st.text} placeholder={i === 0 ? 'e.g. Go to the home office — the safe is behind the books' : 'What do they do next?'} />
          <div class="step-links">
            <EntityPicker {pkg} target={st} key="ref_id" single kinds={['location', 'item']} placeholder="Link the place or item…" />
            <EntityPicker {pkg} target={st} key="photo_id" single kinds={['attachment']} placeholder="Add a photo…" />
          </div>
        </div>
      {/each}
      <button class="addbtn" onclick={addStep}>+ Add step</button>
    </div>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}

<style>
  .roles { display: flex; flex-wrap: wrap; gap: 6px; }
  .step { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--rule-soft); border-left: 2px solid var(--accent); margin-bottom: 8px; background: var(--paper); }
  .step-head { display: flex; align-items: center; gap: 4px; }
  .step-num {
    width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center;
    background: var(--accent-wash); color: var(--accent-deep); font-size: 12px; font-weight: 600;
  }
  .step-head .spacer { flex: 1; }
  .step-tool { width: 26px; height: 26px; }
  .step-links { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 560px) { .step-links { grid-template-columns: 1fr; } }
</style>
