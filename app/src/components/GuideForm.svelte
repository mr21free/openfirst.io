<script>
  import EntityPicker from './EntityPicker.svelte';
  import TagSelect from './TagSelect.svelte';

  let { pkg, raw, store = null, onDelete } = $props();

  const roleOptions = $derived(pkg.roleOptions());

  // Editor writes go through the store (which owns the data) so this form
  // never mutates a prop it doesn't own — see store.svelte.js ensureGuideShape.
  $effect(() => { if (raw) store?.ensureGuideShape?.(raw.id); });

  // Auto-stamp "updated" when the guide actually changes (not on mere open).
  let baselineId = null, baseline = null;
  $effect(() => {
    if (!raw) return;
    const key = JSON.stringify({ ...$state.snapshot(raw), updated: undefined });
    if (raw.id !== baselineId) { baselineId = raw.id; baseline = key; return; }
    if (key !== baseline) { baseline = key; store?.touchGuide?.(raw.id); }
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
      <select value={raw.importance} onchange={(e) => store?.setGuideImportance?.(raw.id, e.target.value || undefined)}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    </label>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}
