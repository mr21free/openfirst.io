<script>
  import TrashIcon from './TrashIcon.svelte';
  import { deferFocus } from '../lib/autofocus.js';
  let { pkg, store, raw, onDelete } = $props();

  let firstInput = $state(null);
  $effect(() => deferFocus(firstInput));

  const byName = (a, b) => pkg.name(a.id).localeCompare(pkg.name(b.id), undefined, { numeric: true, sensitivity: 'base' });
  const assignedPeople = $derived((store?.data?.people || []).filter((p) => (p.roles || []).includes(raw?.id)).sort(byName));
  const availablePeople = $derived((store?.data?.people || []).filter((p) => !(p.roles || []).includes(raw?.id)).sort(byName));
  const assignedGuides = $derived((store?.data?.guides || []).filter((g) => (g.audience_roles || []).includes(raw?.id)).sort(byName));
  const availableGuides = $derived((store?.data?.guides || []).filter((g) => !(g.audience_roles || []).includes(raw?.id)).sort(byName));

  function addPerson(id) {
    const person = store?.data?.people?.find((p) => p.id === id);
    if (!person || !raw) return;
    if (!Array.isArray(person.roles)) person.roles = [];
    if (!person.roles.includes(raw.id)) person.roles.push(raw.id);
  }

  function removePerson(id) {
    const person = store?.data?.people?.find((p) => p.id === id);
    const i = person?.roles?.indexOf(raw.id) ?? -1;
    if (i >= 0) person.roles.splice(i, 1);
  }

  function addGuide(id) {
    const guide = store?.data?.guides?.find((g) => g.id === id);
    if (!guide || !raw) return;
    if (!Array.isArray(guide.audience_roles)) guide.audience_roles = [];
    if (!guide.audience_roles.includes(raw.id)) guide.audience_roles.push(raw.id);
  }

  function removeGuide(id) {
    const guide = store?.data?.guides?.find((g) => g.id === id);
    const i = guide?.audience_roles?.indexOf(raw.id) ?? -1;
    if (i >= 0) guide.audience_roles.splice(i, 1);
  }
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Name</span><input bind:this={firstInput} bind:value={raw.name} placeholder="e.g. Executor" /></label>

    <div class="f">
      <span class="lbl">Assigned people</span>
      <div class="picker">
        {#if assignedPeople.length}
          <div class="pchips">
            {#each assignedPeople as person}
              <span class="pchip"><span>{pkg.name(person.id)}</span><button class="x" title="Delete" onclick={() => removePerson(person.id)}><TrashIcon size={11} /></button></span>
            {/each}
          </div>
        {/if}
        {#if availablePeople.length}
          <select value="" onchange={(e) => { addPerson(e.target.value); e.target.value = ''; }}>
            <option value="">Add a person…</option>
            {#each availablePeople as person}<option value={person.id}>{pkg.name(person.id)}</option>{/each}
          </select>
        {:else if !assignedPeople.length}
          <span class="tiny muted">No people yet — add someone in the <strong>People</strong> section first.</span>
        {/if}
      </div>
    </div>

    <div class="f">
      <span class="lbl">Used by guides</span>
      <div class="picker">
        {#if assignedGuides.length}
          <div class="pchips">
            {#each assignedGuides as guide}
              <span class="pchip"><span>{pkg.name(guide.id)}</span><button class="x" title="Delete" onclick={() => removeGuide(guide.id)}><TrashIcon size={11} /></button></span>
            {/each}
          </div>
        {/if}
        {#if availableGuides.length}
          <select value="" onchange={(e) => { addGuide(e.target.value); e.target.value = ''; }}>
            <option value="">Add a guide…</option>
            {#each availableGuides as guide}<option value={guide.id}>{pkg.name(guide.id)}</option>{/each}
          </select>
        {:else if !assignedGuides.length}
          <span class="tiny muted">Nothing to choose yet — add guides first.</span>
        {/if}
      </div>
    </div>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}
