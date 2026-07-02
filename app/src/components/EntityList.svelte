<script>
  import Importance from './Importance.svelte';
  import Icon from './Icon.svelte';
  import { entityIconKind } from '../lib/icons.js';

  let { pkg, ids = [], onOpen } = $props();

  const orderedIds = $derived(pkg.orderedIds(ids));

  function sub(id) {
    const e = pkg.entity(id);
    if (!e) return 'missing';
    if (e.kind === 'person') return (e.obj.roles || []).map((r) => pkg.roleLabel(r)).join(', ');
    if (e.kind === 'item') return e.obj.price || 'Item';
    if (e.kind === 'location') {
      // Show the full nesting as breadcrumbs, e.g. "Slovakia › City".
      const path = pkg.locationPath(id);
      return path.length ? path.map((a) => pkg.name(a.id)).join(' › ') : 'Location';
    }
    if (e.kind === 'guide') return 'Guide';
    if (e.kind === 'attachment') return pkg.fileType(id);
    return e.kind;
  }
</script>

<div class="ulist">
  {#each orderedIds as id}
    {@const e = pkg.entity(id)}
    <button class="ulist-row" onclick={() => onOpen?.(id)}>
      <!-- Leading type icon so a file/location/person reads at a glance. -->
      <span class="ulist-ico" aria-hidden="true"><Icon kind={entityIconKind(pkg, id)} /></span>
      <span class="ulist-main">
        <span class="ulist-name">
          {#if e?.obj?.sensitive}<span class="lock-dot" title="sensitive">●</span> {/if}{pkg.name(id)}
        </span>
        <span class="ulist-desc">{sub(id)}</span>
      </span>
      <span class="ulist-aside">
        {#if e?.obj?.importance && e?.kind !== 'person'}<Importance level={e.obj.importance} />{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  /* In the side panel these rows read as a clean list — no border, just a
     hover wash (the main center lists keep their card border). */
  .ulist-row { border: none; }
  .ulist-ico {
    flex: none; width: 30px; height: 30px; border-radius: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-soft); background: var(--accent-wash);
  }
</style>
