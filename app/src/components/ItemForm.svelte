<script>
  import EntityPicker from './EntityPicker.svelte';
  import GuideContentEditor from './GuideContentEditor.svelte';

  let { pkg, raw, onDelete } = $props();

  let firstInput = $state(null);
  $effect(() => { if (firstInput) firstInput.focus(); });
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Name</span><input bind:this={firstInput} bind:value={raw.name} placeholder="e.g. Password Manager" /></label>
    <label class="f"><span class="lbl">Description</span><textarea rows="2" bind:value={raw.description}></textarea></label>
    <div class="f"><span class="lbl">Notes</span>
      <GuideContentEditor {pkg} {raw} compact value={raw.notes || ''} onValue={(v) => (raw.notes = v)} placeholder={'Notes — format text, or type “@” to mention a person, item or location.'} />
    </div>
    <div class="grid2">
      <label class="f"><span class="lbl">Importance</span>
        <select bind:value={raw.importance}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      </label>
      <label class="f"><span class="lbl">Price</span><input bind:value={raw.price} placeholder="e.g. 45 EUR / year" /></label>
    </div>

    <div class="f"><span class="lbl">Where it is (locations)</span>
      <EntityPicker {pkg} target={raw} key="location_ids" kinds={['location']} placeholder="Add a location…" />
    </div>
    <div class="f"><span class="lbl">Stored inside (item)</span>
      <EntityPicker {pkg} target={raw} key="container_ids" kinds={['item']} exclude={[raw.id]} placeholder="Add a container item…" />
    </div>
    <div class="f"><span class="lbl">Holds these items</span>
      <EntityPicker {pkg} target={raw} reverse reverseKey="container_ids" kinds={['item']} exclude={[raw.id]} placeholder="Add an item kept inside this…" />
    </div>
    <div class="f"><span class="lbl">Who can access</span>
      <EntityPicker {pkg} target={raw} key="access_person_ids" kinds={['person']} placeholder="Add a person…" />
    </div>
    <div class="f"><span class="lbl">Depends on</span>
      <EntityPicker {pkg} target={raw} key="depends_on_ids" kinds={['item']} exclude={[raw.id]} placeholder="Add an item…" />
    </div>
    <div class="f"><span class="lbl">Needed by</span>
      <EntityPicker {pkg} target={raw} reverse reverseKey="depends_on_ids" kinds={['item']} exclude={[raw.id]} placeholder="Add an item that needs this…" />
    </div>
    <div class="f"><span class="lbl">Explained in (guides)</span>
      <EntityPicker {pkg} target={raw} key="guide_ids" kinds={['guide']} placeholder="Add a guide…" />
    </div>
    <div class="f"><span class="lbl">Attachments</span>
      <EntityPicker {pkg} target={raw} reverse reverseKey="item_ids" kinds={['attachment']} placeholder="Add a file…" />
    </div>

    <label class="toggle"><input type="checkbox" checked={raw.sensitive || false} onchange={(e) => (raw.sensitive = e.target.checked)} /> <span>Sensitive — handle with care</span></label>
    {#if raw.sensitive}
      <p class="tiny muted">Never store the actual secret (password, PIN, seed) in this plan — describe where to find it instead. The plan is a map, not a vault.</p>
    {/if}

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}

<style>
  .caution-box { display: flex; flex-direction: column; gap: 12px; border: 1px solid oklch(0.85 0.06 50); background: var(--warn-wash); border-radius: 10px; padding: 12px; }
</style>
