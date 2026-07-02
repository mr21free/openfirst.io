<script>
  import TrashIcon from './TrashIcon.svelte';
  import { slugifyTag } from '../lib/package.js';

  // Free-form tag editor: type a tag (Enter/comma to add), with autocomplete
  // over existing tags. Edits a slug array on target[key].
  let { target, key = 'tags', suggestions = [], placeholder = 'Add a tag…' } = $props();

  let val = $state('');
  const listId = 'taglist-' + Math.random().toString(36).slice(2, 8);
  const selected = $derived(target?.[key] || []);

  function add(raw) {
    const t = slugifyTag(raw);
    if (!t) { val = ''; return; }
    if (!Array.isArray(target[key])) target[key] = [];
    if (!target[key].includes(t)) target[key].push(t);
    val = '';
  }
  function remove(t) { const i = (target[key] || []).indexOf(t); if (i >= 0) target[key].splice(i, 1); }
  function onKey(e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(val); } }
</script>

<div class="picker">
  {#if selected.length}
    <div class="pchips">
      {#each selected as t}<span class="pchip"><span># {t}</span><button class="x" title="Remove" onclick={() => remove(t)}><TrashIcon size={11} /></button></span>{/each}
    </div>
  {/if}
  <div class="tag-add">
    <input class="inp" list={listId} bind:value={val} {placeholder} onkeydown={onKey} />
    <datalist id={listId}>{#each suggestions.filter((s) => !selected.includes(s)) as s}<option value={s}></option>{/each}</datalist>
    <button class="mini" type="button" title="Add tag" aria-label="Add tag" onclick={() => add(val)}>+</button>
  </div>
</div>

<style>
  .tag-add { display: flex; gap: 6px; align-items: center; }
  .tag-add .inp { flex: 1; min-width: 0; font: inherit; font-size: 14px; color: var(--ink); border: 1px solid var(--rule); border-radius: 0; padding: 7px 10px; background: var(--paper); }
  .tag-add .inp:focus { outline: none; border-color: var(--accent-deep); }
  .mini { flex: none; width: 32px; height: 32px; border-radius: 0; border: 1px solid var(--rule); color: var(--ink-soft); background: var(--paper); font-size: 18px; line-height: 1; }
  .mini:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
</style>
