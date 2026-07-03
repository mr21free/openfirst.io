<script>
  import EntityPicker from './EntityPicker.svelte';
  import TagInput from './TagInput.svelte';
  let { pkg, raw, onDelete } = $props();
  const url = $derived(raw ? pkg.attachmentUrls[raw.id] : null);
</script>

{#if raw}
  <div class="frm">
    {#if url && (raw.mime || '').startsWith('image/')}<img class="prev" src={url} alt={raw.filename} />{/if}
    <label class="f"><span class="lbl">File name</span><input bind:value={raw.filename} /></label>
    <label class="f"><span class="lbl">Description</span><input bind:value={raw.description} /></label>
    <div class="f"><span class="lbl">Tags</span>
      <TagInput target={raw} key="tags" suggestions={pkg.allTags()} placeholder="e.g. tax, will, bitcoin…" />
    </div>
    <div class="f"><span class="lbl">Attached to items</span>
      <EntityPicker {pkg} target={raw} key="item_ids" kinds={['item']} placeholder="Add an item…" />
    </div>
    <div class="f"><span class="lbl">Attached to guides</span>
      <EntityPicker {pkg} target={raw} key="guide_ids" kinds={['guide']} placeholder="Add a guide…" />
    </div>
    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}

<style>.prev { width: 100%; border-radius: 0; border: 1px solid var(--rule-soft); margin-top: 16px; margin-bottom: 4px; }</style>
