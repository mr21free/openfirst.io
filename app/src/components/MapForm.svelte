<script>
  import EntityPicker from './EntityPicker.svelte';
  import TagSelect from './TagSelect.svelte';
  import InfoHint from './InfoHint.svelte';

  let { pkg, raw } = $props(); // raw = data.package

  const roleOptions = $derived(pkg.roleOptions());
</script>

{#if raw}
  <div class="frm">
    <div class="f"><span class="lbl">Who can see Map (roles)<InfoHint text="Leave empty to show Map to everyone. Add roles or people to restrict it." /></span>
      <TagSelect options={roleOptions} target={raw} key="map_audience_roles" placeholder="Add a role..." />
    </div>
    <div class="f"><span class="lbl">...or specific people</span>
      <EntityPicker {pkg} target={raw} key="map_audience_person_ids" kinds={['person']} placeholder="Add a person..." />
    </div>
  </div>
{/if}
