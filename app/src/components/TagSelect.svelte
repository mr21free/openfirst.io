<script>
  import TrashIcon from './TrashIcon.svelte';
  // Multi-select over a fixed option list (e.g. roles) — same chips + dropdown
  // experience as EntityPicker, editing a string array on target[key].
  let { options, target, key, placeholder = 'Add…' } = $props();

  const selected = $derived(target?.[key] || []);
  const available = $derived(options.filter((o) => !selected.includes(o.value)));
  function add(v) { if (!v) return; if (!Array.isArray(target[key])) target[key] = []; if (!target[key].includes(v)) target[key].push(v); }
  function remove(v) { const i = (target[key] || []).indexOf(v); if (i >= 0) target[key].splice(i, 1); }
  const labelOf = (v) => options.find((o) => o.value === v)?.label || v;
</script>

<div class="picker">
  {#if selected.length}
    <div class="pchips">
      {#each selected as v}<span class="pchip"><span>{labelOf(v)}</span><button class="x" title="Delete" onclick={() => remove(v)}><TrashIcon size={11} /></button></span>{/each}
    </div>
  {/if}
  {#if available.length}
    <select value="" onchange={(e) => { add(e.target.value); e.target.value = ''; }}>
      <option value="">{placeholder}</option>
      {#each available as o}<option value={o.value}>{o.label}</option>{/each}
    </select>
  {/if}
</div>
