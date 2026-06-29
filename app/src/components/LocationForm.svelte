<script>
  import EntityPicker from './EntityPicker.svelte';

  let { pkg, raw, onDelete } = $props();

  let firstInput = $state(null);
  $effect(() => { if (firstInput) firstInput.focus(); });
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Name</span><input bind:this={firstInput} bind:value={raw.name} placeholder="e.g. Germany, Berlin, Home Trezor" /></label>
    <label class="f"><span class="lbl">Notes</span><textarea rows="2" bind:value={raw.notes}></textarea></label>

    <div class="f"><span class="lbl">Who can access it</span>
      <EntityPicker {pkg} target={raw} key="access_person_ids" kinds={['person']} placeholder="Add a person…" />
    </div>
    <div class="f"><span class="lbl">Depends on</span>
      <EntityPicker {pkg} target={raw} key="depends_on_ids" kinds={['item']} placeholder="Add an item…" />
    </div>
    <div class="f"><span class="lbl">What is stored here</span>
      <EntityPicker {pkg} target={raw} reverse reverseKey="location_ids" kinds={['item']} placeholder="Add an item kept here…" />
    </div>

    <label class="f"><span class="lbl">Importance</span>
      <select bind:value={raw.importance}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    </label>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}
