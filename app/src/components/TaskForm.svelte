<script>
  import EntityPicker from './EntityPicker.svelte';
  import GuideContentEditor from './GuideContentEditor.svelte';
  import TagInput from './TagInput.svelte';

  let { pkg, raw, onDelete } = $props();
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Title</span><input bind:value={raw.title} placeholder="e.g. Update the Bitcoin guide" /></label>
    <label class="f"><span class="lbl">Status</span>
      <select bind:value={raw.status}>
        <option value="">—</option>
        <option value="planned">Planned</option>
        <option value="in_progress">In Progress</option>
        <option value="completed">Completed</option>
      </select>
    </label>
    <label class="f"><span class="lbl">Importance</span>
      <select bind:value={raw.importance}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    </label>
    <div class="f"><span class="lbl">Description</span>
      <GuideContentEditor {pkg} {raw} compact value={raw.description || ''} onValue={(v) => raw.description = v} placeholder="What needs to happen?" />
    </div>
    <div class="f"><span class="lbl">Assigned people</span><EntityPicker {pkg} target={raw} key="person_ids" kinds={['person']} placeholder="Add a person…" /></div>
    <div class="f"><span class="lbl">Locations</span><EntityPicker {pkg} target={raw} key="location_ids" kinds={['location']} placeholder="Add a location…" /></div>
    <div class="f"><span class="lbl">Tags</span>
      <TagInput target={raw} key="tags" suggestions={pkg.allTaskTags()} placeholder="e.g. bitcoin, annual-review…" />
    </div>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}
