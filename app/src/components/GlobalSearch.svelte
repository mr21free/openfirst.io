<script>
  /*
    The top-bar search box and its top-10 dropdown. Owns its own open/keyboard
    state; the parent keeps `query` (bindable, so the full "search" results view
    can read it) and handles what a pick / "see all" does.
  */
  let { pkg, query = $bindable(''), filter = (r) => r, onPick, onSeeAll } = $props();

  let open = $state(false);
  let index = $state(-1);
  let popEl = $state(null);

  const KIND_LABEL = { guide: 'Guide', person: 'Person', item: 'Item', location: 'Location', attachment: 'File', role: 'Role', readiness: 'Readiness' };
  const top = $derived(query.trim() ? filter(pkg.search(query, 10)) : []);

  function pick(r) { open = false; index = -1; onPick(r.id); }
  function seeAll() { open = false; index = -1; if (query.trim()) onSeeAll(); }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); open = true; index = Math.min(index + 1, top.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, -1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (index >= 0 && top[index]) pick(top[index]); else seeAll(); }
    else if (e.key === 'Escape') { e.preventDefault(); open = false; index = -1; }
  }
  // Keep the highlighted dropdown row in view; close on click-away.
  $effect(() => { if (!open) return; index; popEl?.querySelector('.gs-row.on')?.scrollIntoView({ block: 'nearest' }); });
  $effect(() => {
    if (!open) return;
    const onDown = (e) => { const t = e.target; if (!(t instanceof Element) || !t.closest('.gsearch')) open = false; };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<div class="gsearch">
  <svg class="gs-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
  <input class="gs-input" type="text" bind:value={query} placeholder="Search the plan…" aria-label="Search the plan" autocomplete="off"
    onfocus={() => { if (query.trim()) open = true; }}
    oninput={() => { open = true; index = -1; }}
    onkeydown={onKey} />
  {#if open && top.length}
    <div class="gs-pop" bind:this={popEl}>
      {#each top as r, i (r.id)}
        <button class="gs-row" class:on={i === index} onmousedown={(e) => { e.preventDefault(); pick(r); }}>
          <span class="gs-name">{r.name}</span>
          <span class="gs-meta">{KIND_LABEL[r.kind]}{r.inGuide ? ' · in a guide' : r.importance === 'high' ? ' · high priority' : ''}</span>
        </button>
      {/each}
      <button class="gs-row gs-all" onmousedown={(e) => { e.preventDefault(); seeAll(); }}>See all results for “{query.trim()}”</button>
    </div>
  {/if}
</div>

<style>
  .gsearch { position: relative; min-width: 0; width: 100%; display: flex; align-items: center; }
  .gs-ico { position: absolute; left: 11px; color: var(--ink-mute); pointer-events: none; }
  .gs-input { width: 100%; font: inherit; font-size: 14px; padding: 7px 12px 7px 33px; border: 1px solid var(--rule); border-radius: 0; background: var(--paper); color: var(--ink); }
  .gs-input:focus { outline: none; border-color: var(--accent-deep); }
  .gs-pop { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 16px 40px oklch(0.2 0.03 255 / 0.18); padding: 6px; max-height: 60vh; overflow-y: auto; }
  .gs-row { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 8px; }
  .gs-row:hover, .gs-row.on { background: var(--accent-wash); }
  .gs-name { font-size: 14px; color: var(--ink); }
  .gs-meta { font-size: 11px; color: var(--ink-mute); }
  .gs-all { color: var(--accent-deep); font-size: 13px; border-top: 1px solid var(--rule-soft); margin-top: 4px; }
</style>
