<script>
  import FilterBar from './FilterBar.svelte';
  import Icon from './Icon.svelte';
  import Importance from './Importance.svelte';
  import TrashIcon from './TrashIcon.svelte';

  let {
    pkg,
    editing = false,
    checks = [],
    selectedIds = [],
    onSelect = null,
    onOpen = null,
    onDelete = null,
    onAdd = null,
    onBulkTag = null,
    runs = [],
    onDeleteRun = null,
    onDeleteRuns = null,
    onOpenRun = null,
    selectActions = null
  } = $props();

  let tab = $state('questions');
  let query = $state('');
  let filters = $state({ scope: ['external'] });
  let testQuery = $state('');
  let testFilters = $state({});
  let bulkTag = $state('');
  let selectedRunIds = $state([]);

  const scopeLabel = (scope) => scope === 'internal' ? 'Internal' : 'Dry run';
  const facets = $derived([
    {
      key: 'scope',
      label: 'Kind',
      test: (c, v) => (c.scope || 'external') === v,
      options: [
        { value: 'external', label: 'Dry run', count: checks.filter((c) => (c.scope || 'external') === 'external').length },
        { value: 'internal', label: 'Internal', count: checks.filter((c) => c.scope === 'internal').length }
      ].filter((o) => o.count)
    },
    {
      key: 'person',
      label: 'Person',
      test: (c, v) => (c.person_ids || []).includes(v),
      options: pkg.people.map((p) => ({ value: p.id, label: pkg.name(p.id), count: checks.filter((c) => (c.person_ids || []).includes(p.id)).length })).filter((o) => o.count)
    },
    {
      key: 'tag',
      label: 'Tag',
      test: (c, v) => (c.tags || []).includes(v),
      options: pkg.allReadinessTags().map((t) => ({ value: t, label: '# ' + t, count: pkg.readinessWithTag(t).length }))
    }
  ]);

  const matches = (c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [pkg.name(c.id), c.question, c.expected, c.owner_notes, ...(c.person_ids || []).map((id) => pkg.name(id)), ...(c.tags || [])]
      .some((x) => String(x || '').toLowerCase().includes(q));
  };
  const passes = (c) => facets.every((f) => {
    const sel = filters[f.key];
    return !sel?.length || sel.some((v) => f.test(c, v));
  });
  const visibleChecks = $derived(checks.filter((c) => matches(c) && passes(c)));
  const ids = $derived(visibleChecks.map((c) => c.id));
  const testFacets = $derived([
    {
      key: 'person',
      label: 'Person',
      test: (run, v) => (run.person_id || '__admin') === v,
      options: [
        { value: '__admin', label: 'Admin', count: runs.filter((r) => !r.person_id).length },
        ...pkg.people.map((p) => ({ value: p.id, label: pkg.name(p.id), count: runs.filter((r) => r.person_id === p.id).length }))
      ].filter((o) => o.count)
    },
    {
      key: 'answer',
      label: 'Answer',
      test: (run, v) => (run.results || []).some((r) => (v === 'x' ? (r.status === 'fail' || r.status === 'blocked') : r.status === v)),
      options: [
        { value: 'pass', label: '✓', count: runs.filter((run) => (run.results || []).some((r) => r.status === 'pass')).length },
        { value: 'not_sure', label: '?', count: runs.filter((run) => (run.results || []).some((r) => r.status === 'not_sure')).length },
        { value: 'x', label: '×', count: runs.filter((run) => (run.results || []).some((r) => r.status === 'fail' || r.status === 'blocked')).length }
      ].filter((o) => o.count)
    }
  ]);
  const testMatches = (run) => {
    const q = testQuery.trim().toLowerCase();
    if (!q) return true;
    return [
      run.date,
      runPerson(run),
      ...(run.results || []).flatMap((r) => [pkg.name(r.check_id), r.notes])
    ].some((x) => String(x || '').toLowerCase().includes(q));
  };
  const testPasses = (run) => testFacets.every((f) => {
    const sel = testFilters[f.key];
    return !sel?.length || sel.some((v) => f.test(run, v));
  });
  const visibleRuns = $derived(runs.filter((r) => testMatches(r) && testPasses(r)));
  const visibleRunIds = $derived(visibleRuns.map((r) => r.id));

  function applyBulkTag() {
    const t = bulkTag.trim();
    if (!t || !selectedIds.length) return;
    onBulkTag?.(selectedIds, t);
    bulkTag = '';
  }
  function emptyLabel() {
    return query.trim() ? `No results for "${query.trim()}".` : 'No readiness checks yet.';
  }
  const runPerson = (run) => run.person_id ? pkg.name(run.person_id) : 'Admin';
  function testName(run) {
    const iso = run.submitted_at || run.started_at;
    if (!iso) return run.date || 'No date';
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (_) {
      return `${run.date || 'No date'} ${String(iso).slice(11, 16)}`;
    }
  }
  function durationLabel(ms) {
    if (!ms) return '';
    const sec = Math.max(1, Math.round(ms / 1000));
    if (sec < 60) return `${sec} sec`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem ? `${min} min ${rem} sec` : `${min} min`;
  }
  const allRunsSelected = $derived(visibleRunIds.length > 0 && visibleRunIds.every((id) => selectedRunIds.includes(id)));
  function toggleRun(id) {
    selectedRunIds = selectedRunIds.includes(id) ? selectedRunIds.filter((x) => x !== id) : [...selectedRunIds, id];
  }
  function toggleAllRuns() {
    selectedRunIds = allRunsSelected ? selectedRunIds.filter((id) => !visibleRunIds.includes(id)) : [...new Set([...selectedRunIds, ...visibleRunIds])];
  }
  function deleteSelectedRuns() {
    if (!selectedRunIds.length) return;
    onDeleteRuns?.(selectedRunIds);
    selectedRunIds = [];
  }
</script>

<div class="readiness">
  <div class="section-head no-print">
    <h2 class="vh">Readiness</h2>
    {#if editing && tab === 'questions'}
      <div class="head-actions">
        {#if selectActions}{@render selectActions(ids, 'readiness checks')}{/if}
        <button class="btn btn-small btn-primary" onclick={() => onAdd?.()}>+ New</button>
      </div>
    {:else if tab === 'tests'}
      <div class="head-actions">
        {#if selectedRunIds.length}<button class="btn btn-small del-selected" onclick={deleteSelectedRuns}>Delete selected ({selectedRunIds.length})</button>{/if}
        {#if visibleRunIds.length}<button class="btn btn-small" onclick={toggleAllRuns}>{allRunsSelected ? 'Deselect all' : 'Select all'}</button>{/if}
      </div>
    {/if}
  </div>
  <div class="tabs no-print" role="tablist" aria-label="Readiness views">
    <button class:on={tab === 'questions'} onclick={() => (tab = 'questions')}>Questions / tasks</button>
    <button class:on={tab === 'tests'} onclick={() => (tab = 'tests')}>Tests</button>
  </div>

  {#if tab === 'questions'}
    {#if checks.length}
      <FilterBar facets={facets} bind:filters bind:search={query} placeholder="Search readiness…" />
    {/if}

    {#if editing && selectedIds.length}
      <div class="bulk-tag no-print">
        <span class="tiny muted">Tag {selectedIds.length} selected:</span>
        <input class="bulk-input" list="readiness-tags" bind:value={bulkTag} placeholder="e.g. bitcoin, annual-review" onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), applyBulkTag())} />
        <datalist id="readiness-tags">{#each pkg.allReadinessTags() as t}<option value={t}></option>{/each}</datalist>
        <button class="btn btn-small" onclick={applyBulkTag} disabled={!bulkTag.trim()}>Add tag</button>
      </div>
    {/if}

    <div class="ulist">
      {#each visibleChecks as check, i (check.id)}
        <div class="ulist-row">
          {#if editing}<input type="checkbox" class="rowcheck no-print" checked={selectedIds.includes(check.id)} onclick={(e) => onSelect?.(ids, i, e)} aria-label="Select" />{/if}
          <span class="list-row-ico" aria-hidden="true"><Icon kind="readiness" /></span>
          <button class="ulist-click" onclick={() => onOpen?.(check.id)}>
            <span class="ulist-main">
              <span class="ulist-name">{pkg.name(check.id)}</span>
              <span class="ulist-desc">{check.scope === 'internal' ? (check.owner_notes || 'Owner-only task or gap') : (check.question || 'Dry-run question')}</span>
              <span class="readiness-meta">
                <span class="chip">{scopeLabel(check.scope)}</span>
                {#if (check.person_ids || []).length}<span class="chip">{(check.person_ids || []).map((id) => pkg.name(id)).join(', ')}</span>{/if}
                {#if check.tags?.length}{#each check.tags as t}<span class="row-tag"># {t}</span>{/each}{/if}
              </span>
            </span>
          </button>
          <span class="ulist-aside">
            <Importance level={check.importance} compact />
            {#if editing}<button class="rowdel no-print" title="Delete" aria-label="Delete" onclick={() => onDelete?.(check.id)}><TrashIcon /></button>{/if}
          </span>
        </div>
      {:else}
        <p class="empty-results">{emptyLabel()}</p>
      {/each}
    </div>
  {:else}
    {#if runs.length}
      <FilterBar facets={testFacets} bind:filters={testFilters} bind:search={testQuery} placeholder="Search tests…" />
    {/if}
    <div class="ulist">
      {#each visibleRuns as run (run.id)}
        <div class="ulist-row run-row">
          <input type="checkbox" class="rowcheck no-print" checked={selectedRunIds.includes(run.id)} onclick={() => toggleRun(run.id)} aria-label="Select test" />
          <span class="list-row-ico" aria-hidden="true"><Icon kind="readiness" /></span>
          <button class="ulist-click" onclick={() => onOpenRun?.(run.id)}>
            <span class="ulist-main">
              <span class="ulist-name">{testName(run)}</span>
              <span class="ulist-desc">{runPerson(run)} · {(run.results || []).length} result{(run.results || []).length === 1 ? '' : 's'}{#if run.duration_ms} · {durationLabel(run.duration_ms)}{/if}</span>
            </span>
          </button>
          <span class="ulist-aside">
            <button class="rowdel no-print" title="Delete test run" aria-label="Delete test run" onclick={() => onDeleteRun?.(run.id)}><TrashIcon /></button>
          </span>
        </div>
      {:else}
        <p class="empty-results">{testQuery.trim() ? `No tests for "${testQuery.trim()}".` : 'No tests yet.'}</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .readiness { display: flex; flex-direction: column; gap: 14px; }
  .vh { font-size: clamp(22px, 3vw, 30px); }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .head-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  /* The mobile nav toggle bar already names the current section — this
     heading just repeats it and eats space that could go to the list. */
  @media (max-width: 820px) { .vh { display: none; } }
  .tabs { display: flex; align-items: center; gap: 28px; border-bottom: 1px solid var(--rule); margin-top: -4px; }
  .tabs button { position: relative; padding: 0 0 10px; color: var(--ink-soft); font-size: 14px; }
  .tabs button.on { color: var(--accent-deep); }
  .tabs button.on::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--accent-deep); }
  :global(.del-selected) { color: var(--warn); border: 1px solid oklch(0.85 0.06 50); background: var(--paper); }
  :global(.del-selected:hover) { background: var(--warn-wash); }
  .rowcheck { flex: none; width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-deep); }
  .ulist-click { flex: 1; min-width: 0; display: flex; background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: inherit; }
  .ulist-aside { margin-left: auto; }
  .rowdel { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); border: 1px solid transparent; flex: none; display: inline-flex; align-items: center; justify-content: center; }
  .rowdel:hover { color: var(--warn); border-color: var(--rule); background: var(--paper); }
  .list-row-ico {
    flex: none;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-mute);
    background: var(--accent-wash);
  }
  .readiness-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
  .bulk-tag { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 4px; padding: 10px 12px; background: var(--accent-wash); border-radius: 9px; }
  .bulk-input { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; background: var(--paper); color: var(--ink); }
  .bulk-input:focus { outline: none; border-color: var(--accent-deep); }
  .row-tag { font-size: 11px; color: var(--accent-deep); background: var(--accent-wash); border-radius: 5px; padding: 1px 6px; }
</style>
