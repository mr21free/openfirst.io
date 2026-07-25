<script>
  // Search + faceted filter + sort bar (Productboard-style). Facets are
  // multi-select; within a facet selections are OR, across facets they are AND.
  // Purely a controlled UI — the parent owns `search`, `filters` and `sort`.
  // facets: [{ key, label, options: [{ value, label, count }] }]
  // filters: { [facetKey]: [selectedValue] }
  // sorts:  [{ value, label }]
  // alignStart: by default the popover's right edge aligns to the button's
  // right edge, opening leftward — right for a button sitting at the right
  // of the bar. Set true for a button (like Map's, hideSearch, no search box
  // pushing it over) that sits at the left of the bar, where opening
  // leftward would run the popover off-screen — it opens rightward instead.
  let { facets = [], sorts = [], filters = $bindable({}), sort = $bindable('default'), search = $bindable(''), placeholder = 'Search…', hideSearch = false, alignStart = false } = $props();

  let open = $state(false);
  let sortOpen = $state(false);
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
  function pickSort(v) { sort = v; sortOpen = false; }

  $effect(() => {
    if (!open && !sortOpen) return;
    const onDown = (e) => {
      if (open && !e.target.closest?.('.filterwrap')) open = false;
      if (sortOpen && !e.target.closest?.('.sortwrap')) sortOpen = false;
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<div class="filterbar no-print">
  {#if !hideSearch}<input class="search" type="search" {placeholder} bind:value={search} />{/if}

  {#if usable.length}
    <div class="filterwrap">
      <button class="iconbtn filterbtn" class:on={activeCount > 0} onclick={() => (open = !open)} aria-expanded={open} aria-label="Filter" data-tip="Filter">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        {#if activeCount}<span class="fcount">{activeCount}</span>{/if}
      </button>
      {#if open}
        <div class="filterpop" class:align-start={alignStart}>
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
    <div class="sortwrap">
      <button class="iconbtn sortbtn" onclick={() => (sortOpen = !sortOpen)} aria-expanded={sortOpen} aria-label="Sort" data-tip="Sort">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></svg>
      </button>
      {#if sortOpen}
        <div class="sortpop" class:align-start={alignStart}>
          {#each sorts as s}
            <button class="sort-opt" class:on={s.value === sort} onclick={() => pickSort(s.value)}>
              <span class="sort-name">{s.label}</span>
              {#if s.value === sort}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if activeCount}
  <div class="filterpills no-print">
    {#each activeFacets as f}
      <span class="fpill"><span class="fpill-k">{f.label}:</span> {filters[f.key].map((v) => labelFor(f, v)).join(', ')}<button class="fpill-x" title="Remove" aria-label={`Clear ${f.label}`} onclick={() => clearFacet(f.key)}>✕</button></span>
    {/each}
    <button class="pill-clear" onclick={clearAll}>Clear all</button>
  </div>
{/if}

<style>
  .filterbar { display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
  /* Search, filter and sort share one height so they line up as equal controls. */
  .filterbar .search { flex: 1; min-width: 160px; height: 40px; font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 0; padding: 0 12px; background: var(--paper); color: var(--ink); }
  .filterbar .search:focus { outline: none; border-color: var(--accent-deep); }
  /* Matches GlobalSearch's mobile sizing (.gs-input) so the top-bar search
     and this list search read as the same control, not a bigger one. */
  @media (max-width: 820px) { .filterbar .search { height: auto; padding: 4px 12px; border-color: var(--rule-soft); } }
  .filterwrap { position: relative; flex: none; }
  .filterbtn { position: relative; }
  .fcount { position: absolute; top: -6px; right: -6px; background: var(--accent-deep); color: var(--paper); border-radius: 999px; min-width: 17px; height: 17px; padding: 0 4px; display: inline-grid; place-items: center; font-size: 10px; line-height: 1; }
  .filterpop { position: absolute; top: calc(100% + 6px); right: 0; z-index: var(--z-popover); width: 280px; max-width: 86vw; max-height: 60vh; overflow-y: auto; background: var(--paper); border: 1px solid var(--rule); border-radius: 0; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 8px; }
  .filterpop.align-start { right: auto; left: 0; }
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
  .sortwrap { position: relative; flex: none; }
  .sortpop { position: absolute; top: calc(100% + 6px); right: 0; z-index: var(--z-popover); width: 200px; max-width: 86vw; background: var(--paper); border: 1px solid var(--rule); border-radius: 0; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 6px; }
  .sortpop.align-start { right: auto; left: 0; }
  .sort-opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 7px; font-size: 14px; text-align: left; color: var(--ink); }
  .sort-opt:hover { background: var(--accent-wash); }
  .sort-opt.on { color: var(--accent-deep); font-weight: 500; }
  .sort-opt svg { flex: none; }
  .filterpills { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
  .fpill { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); background: var(--accent-wash); border-radius: 999px; padding: 4px 6px 4px 11px; }
  .fpill-k { color: var(--ink-mute); }
  .fpill-x { color: var(--ink-mute); width: 18px; height: 18px; border-radius: 999px; }
  .fpill-x:hover { background: var(--accent); color: var(--paper); }
  .pill-clear { font-size: 12.5px; color: var(--ink-mute); padding: 4px 8px; }
  .pill-clear:hover { color: var(--ink); }
</style>
