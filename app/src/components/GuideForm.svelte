<script>
  import EntityPicker from './EntityPicker.svelte';
  import TagSelect from './TagSelect.svelte';

  let { pkg, raw, onDelete } = $props();

  const roleOptions = $derived(pkg.roleOptions());
  const today = () => new Date().toISOString().slice(0, 10);

  $effect(() => { if (!raw) return; if (!raw.content) raw.content = {}; if (!raw.references) raw.references = {}; });

  // Auto-stamp "updated" when the guide actually changes (not on mere open).
  let baselineId = null, baseline = null;
  $effect(() => {
    if (!raw) return;
    const key = JSON.stringify({ ...$state.snapshot(raw), updated: undefined });
    if (raw.id !== baselineId) { baselineId = raw.id; baseline = key; return; }
    if (key !== baseline) { baseline = key; const t = today(); if (raw.updated !== t) raw.updated = t; }
  });
</script>

{#if raw}
  <div class="frm">
    <div class="f"><span class="lbl">Visible to roles</span>
      <TagSelect options={roleOptions} target={raw} key="audience_roles" placeholder="Add a role…" />
    </div>
    <div class="f"><span class="lbl">…or specific people</span>
      <EntityPicker {pkg} target={raw} key="audience_person_ids" kinds={['person']} placeholder="Add a person…" />
    </div>

    <p class="tiny muted">Edit the guide’s content directly on the guide page.</p>

    <label class="f"><span class="lbl">Importance</span>
      <select bind:value={raw.importance}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    </label>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}
