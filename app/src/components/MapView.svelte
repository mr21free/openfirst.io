<script>
  // "Where is what" — the location hierarchy as nested containers, with the
  // items that live at each location shown inside. Click a box to open the
  // location, a chip to open the item (which shows its files/people).
  let { pkg, onOpen } = $props();

  const roots = $derived(pkg.locationRoots());
  const unplaced = $derived((pkg.items || []).filter((it) => !(it.location_ids || []).length));
  const empty = $derived(!roots.length && !unplaced.length);
</script>

{#snippet locNode(loc, depth)}
  {@const items = pkg.itemsAtLocation.get(loc.id) || []}
  {@const kids = pkg.locationChildren(loc.id)}
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
  <p class="map-hint tiny muted">A map of what is where. Open a place to see its details, or an item to see its files and who can access it.</p>
  {#each roots as r}{@render locNode(r, 0)}{/each}

  {#if unplaced.length}
    <div class="loc-box root unplaced">
      <div class="loc-head"><span class="loc-name muted">No location set</span><span class="loc-count">{unplaced.length}</span></div>
      <div class="loc-items">
        {#each unplaced as it}<button class="map-chip" onclick={() => onOpen(it.id)}>{pkg.name(it.id)}</button>{/each}
      </div>
    </div>
  {/if}

  {#if empty}<p class="empty-results">No locations or items yet — add some in Locations and Items.</p>{/if}
</div>

<style>
  .map { display: flex; flex-direction: column; gap: 14px; }
  .map-hint { margin: 0 2px 2px; }
  .loc-box {
    border: 1px solid var(--rule); border-radius: 12px;
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
    border: 1px solid var(--rule); border-radius: 999px; padding: 5px 11px; background: var(--paper);
  }
  .map-chip:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
  .unplaced { border-left-color: var(--ink-mute); border-style: dashed; }
  .lock-dot { color: var(--warn); font-size: 9px; }
</style>
