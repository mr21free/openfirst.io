<script>
  import FilterBar from './FilterBar.svelte';

  // "Where is what" — the location hierarchy as nested containers, with the
  // items that live at each location shown inside. Click a box to open the
  // location, a chip to open the item (which shows its files/people).
  // A tag filter (filter-only, no search box) narrows the tree down to items
  // matching the selected tag(s) plus every ancestor location on the way to
  // them, so the place is still reachable in the hierarchy.
  let { pkg, onOpen, filters = $bindable({}) } = $props();

  const tags = $derived(filters.tag || []);
  const filterOn = $derived(tags.length > 0);
  const mapFacets = $derived([
    { key: 'tag', label: 'Tag', test: (it, v) => (it.tags || []).includes(v), options: pkg.allItemTags().map((t) => ({ value: t, label: '# ' + t, count: pkg.itemsWithTag(t).length })) }
  ]);

  const matchedItemIds = $derived.by(() => {
    if (!filterOn) return null; // null = no restriction
    return new Set((pkg.items || []).filter((it) => (it.tags || []).some((t) => tags.includes(t))).map((it) => it.id));
  });
  // Every location that must stay visible: one holding a matched item, or an
  // ancestor of one (so the matched item is still reachable in the tree).
  const visibleLocIds = $derived.by(() => {
    if (!matchedItemIds) return null;
    const set = new Set();
    for (const it of pkg.items || []) {
      if (!matchedItemIds.has(it.id)) continue;
      for (const lid of it.location_ids || []) {
        set.add(lid);
        for (const anc of pkg.locationPath(lid)) set.add(anc.id);
      }
    }
    return set;
  });

  const itemsAt = (locId) => (pkg.itemsAtLocation.get(locId) || []).filter((iid) => !matchedItemIds || matchedItemIds.has(iid));
  const visibleRoots = $derived(pkg.locationRoots().filter((r) => !visibleLocIds || visibleLocIds.has(r.id)));
  const visibleKidsOf = (locId) => pkg.locationChildren(locId).filter((c) => !visibleLocIds || visibleLocIds.has(c.id));
  const unplaced = $derived((pkg.items || []).filter((it) => !(it.location_ids || []).length && (!matchedItemIds || matchedItemIds.has(it.id))));
  const empty = $derived(!visibleRoots.length && !unplaced.length);
</script>

{#snippet locNode(loc, depth)}
  {@const items = itemsAt(loc.id)}
  {@const kids = visibleKidsOf(loc.id)}
  <div class="loc-box" class:root={depth === 0}>
    <div class="loc-head">
      <button class="loc-name" onclick={() => onOpen(loc.id)} title="Open location">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
        {pkg.name(loc.id)}
      </button>
      {#if items.length}<span class="loc-count">{items.length} item{items.length === 1 ? '' : 's'}</span>{/if}
    </div>
    {#if items.length}
      <div class="loc-items">
        {#each items as iid}
          <button class="map-chip" onclick={() => onOpen(iid)} title="Open item">
            {#if pkg.entity(iid)?.obj?.sensitive}<span class="lock-dot" title="sensitive">●</span> {/if}{pkg.name(iid)}
          </button>
        {/each}
      </div>
    {/if}
    {#if kids.length}
      <div class="loc-kids">
        {#each kids as child}{@render locNode(child, depth + 1)}{/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="map">
  <p class="map-hint tiny muted no-print">A map of what is where. Open a place to see its details, or an item to see its files and who can access it.</p>

  {#if pkg.allItemTags().length}
    <FilterBar facets={mapFacets} sorts={[]} bind:filters hideSearch alignStart />
    {#if tags.length}
      <p class="print-only tiny">Filtered by tag{tags.length > 1 ? 's' : ''}: {tags.map((t) => '#' + t).join(', ')}</p>
    {/if}
  {/if}

  {#each visibleRoots as r}{@render locNode(r, 0)}{/each}

  {#if unplaced.length}
    <div class="loc-box root unplaced">
      <div class="loc-head"><span class="loc-name muted">No location set</span><span class="loc-count">{unplaced.length}</span></div>
      <div class="loc-items">
        {#each unplaced as it}<button class="map-chip" onclick={() => onOpen(it.id)}>{pkg.name(it.id)}</button>{/each}
      </div>
    </div>
  {/if}

  {#if empty}
    <p class="empty-results">{filterOn ? 'No items match the selected tag(s).' : 'No locations or items yet — add some in Locations and Items.'}</p>
  {/if}
</div>

<style>
  .map { display: flex; flex-direction: column; gap: 14px; }
  .map-hint { margin: 0 2px 2px; }
  .loc-box {
    border: 1px solid var(--rule); border-radius: 0;
    padding: 12px 14px; background: var(--paper);
  }
  .loc-box.root { border-left: 3px solid var(--accent); }
  /* Nested places sit visually *inside* their parent. */
  .loc-kids { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .loc-kids .loc-box { background: color-mix(in oklch, var(--accent-wash) 40%, var(--paper)); }
  .loc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .loc-name {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 15px; font-weight: 500; color: var(--ink); min-width: 0;
  }
  .loc-name svg { flex: none; color: var(--accent-deep); }
  button.loc-name:hover { color: var(--accent-deep); }
  .loc-count { flex: none; font-size: 11px; color: var(--ink-mute); }
  .loc-items { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
  .map-chip {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 13px; color: var(--ink-soft);
    border: 1px solid var(--rule); border-radius: 8px; padding: 5px 11px; background: var(--paper);
  }
  .map-chip:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
  .unplaced { border-left-color: var(--ink-mute); border-style: dashed; }
  .lock-dot { color: var(--warn); font-size: 9px; }
</style>
