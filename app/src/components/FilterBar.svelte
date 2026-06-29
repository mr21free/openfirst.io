<script>
  // Search + faceted filter + sort bar (Productboard-style). Facets are
  // multi-select; within a facet selections are OR, across facets they are AND.
  // Purely a controlled UI — the parent owns `search`, `filters` and `sort`.
  // facets: [{ key, label, options: [{ value, label, count }] }]
  // filters: { [facetKey]: [selectedValue] }
  // sorts:  [{ value, label }]
  let { facets = [], sorts = [], filters = $bindable({}), sort = $bindable('default'), search = $bindable(''), placeholder = 'Search…' } = $props();

  let open = $state(false);
  const activeFacets = $derived(facets.filter((f) => (filters[f.key] || []).length));
  const activeCount = $derived(activeFacets.reduce((n, f) => n + filters[f.key].length, 0));
  const usable = $derived(facets.filter((f) => f.options.length));

  function toggle(key, val) {
    const cur = filters[key] || [];
    filters = { ...filters, [key]: cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val] };
  }
  function clearFacet(key) { filters = { ...filters, [key]: [] }; }
  function clearAll() { filters = {}; }
  const labelFor = (f, v) => f.options.find((o) => o.value === v)?.label ?? v;

  $effect(() => {
    if (!open) return;
    const onDown = (e) => { if (!e.target.closest?.('.filterwrap')) open = false; };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<div class="filterbar">
  <input class="search" type="search" {placeholder} bind:value={search} />

  {#if usable.length}
    <div class="filterwrap">
      <button class="filterbtn" class:on={activeCount > 0} onclick={() => (open = !open)} aria-expanded={open} aria-label="Filter" title="Filter">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        {#if activeCount}<span class="fcount">{activeCount}</span>{/if}
      </button>
      {#if open}
        <div class="filterpop">
          {#each usable as f}
            <div class="facet">
              <div class="facet-label">{f.label}</div>
              {#each f.options as o}
                <label class="facet-opt">
                  <input type="checkbox" checked={(filters[f.key] || []).includes(o.value)} onchange={() => toggle(f.key, o.value)} />
                  <span class="facet-name">{o.label}</span>
                  <span class="facet-count">{o.count}</span>
                </label>
              {/each}
            </div>
          {/each}
          {#if activeCount}<button class="clear-all" onclick={clearAll}>Clear all</button>{/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if sorts.length}
    <label class="sortwrap"><span class="tiny muted">Sort</span>
      <select class="sortsel" bind:value={sort}>{#each sorts as s}<option value={s.value}>{s.label}</option>{/each}</select>
    </label>
  {/if}
</div>

{#if activeCount}
  <div class="filterpills">
    {#each activeFacets as f}
      <span class="fpill"><span class="fpill-k">{f.label}:</span> {filters[f.key].map((v) => labelFor(f, v)).join(', ')}<button class="fpill-x" title="Remove" aria-label={`Clear ${f.label}`} onclick={() => clearFacet(f.key)}>✕</button></span>
    {/each}
    <button class="pill-clear" onclick={clearAll}>Clear all</button>
  </div>
{/if}

<style>
  .filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filterbar .search { flex: 1; min-width: 160px; font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 9px; padding: 9px 12px; background: var(--paper); color: var(--ink); }
  .filterbar .search:focus { outline: none; border-color: var(--accent-deep); }
  .filterwrap { position: relative; flex: none; }
  .filterbtn { position: relative; display: inline-grid; place-items: center; width: 38px; height: 38px; color: var(--ink-soft); border: 1px solid var(--rule); border-radius: 9px; background: var(--paper); }
  .filterbtn:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
  .filterbtn.on { color: var(--accent-deep); border-color: var(--accent-deep); background: var(--accent-wash); }
  .fcount { position: absolute; top: -6px; right: -6px; background: var(--accent-deep); color: var(--paper); border-radius: 999px; min-width: 17px; height: 17px; padding: 0 4px; display: inline-grid; place-items: center; font-size: 10px; line-height: 1; }
  .filterpop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 280px; max-width: 86vw; max-height: 60vh; overflow-y: auto; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 8px; }
  .facet { padding: 6px 4px; border-bottom: 1px solid var(--rule-soft); }
  .facet:last-of-type { border-bottom: none; }
  .facet-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-mute); padding: 2px 6px 6px; }
  .facet-opt { display: flex; align-items: center; gap: 9px; padding: 6px 6px; border-radius: 7px; cursor: pointer; font-size: 14px; }
  .facet-opt:hover { background: var(--accent-wash); }
  .facet-opt input { accent-color: var(--accent-deep); width: 15px; height: 15px; flex: none; }
  .facet-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .facet-count { flex: none; font-size: 11px; color: var(--ink-mute); }
  .clear-all { width: 100%; margin-top: 6px; font-size: 13px; color: var(--accent-deep); padding: 8px; border-radius: 8px; }
  .clear-all:hover { background: var(--accent-wash); }
  .sortwrap { display: inline-flex; align-items: center; gap: 7px; flex: none; }
  .sortsel { font: inherit; font-size: 13px; color: var(--ink-soft); border: 1px solid var(--rule); border-radius: 8px; padding: 7px 9px; background: var(--paper); }
  .filterpills { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
  .fpill { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); background: var(--accent-wash); border-radius: 999px; padding: 4px 6px 4px 11px; }
  .fpill-k { color: var(--ink-mute); }
  .fpill-x { color: var(--ink-mute); width: 18px; height: 18px; border-radius: 999px; }
  .fpill-x:hover { background: var(--accent); color: var(--paper); }
  .pill-clear { font-size: 12.5px; color: var(--ink-mute); padding: 4px 8px; }
  .pill-clear:hover { color: var(--ink); }
</style>
