<script>
  import FilterBar from './FilterBar.svelte';
  import Icon from './Icon.svelte';
  import Importance from './Importance.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import { markdownPreview } from '../lib/markdown.js';
  import { loadViewPref, saveViewPref } from '../lib/viewPrefs.js';

  let {
    pkg,
    editing = false,
    planId = null,
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
    selectActions = null,
    tasks = [],
    onAddTask = null,
    onBulkTaskTag = null,
    onReorderTask = null
  } = $props();

  // Stamped once, not reactive — shown only in print output (see .print-date).
  const printDate = new Date().toISOString().slice(0, 10);
  // List-row previews render markdown source as plain text, so [[id]] refs
  // need resolving here rather than left as literal tokens (see Prose.svelte).
  const resolveRef = (id) => (pkg.entity(id) ? pkg.name(id) : null);
  let tab = $state('tasks');
  let query = $state('');
  let filters = $state({});
  let testQuery = $state('');
  let testFilters = $state({});
  let bulkTag = $state('');
  let selectedRunIds = $state([]);

  const facets = $derived([
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

  // ---- Tasks (internal builder checklist) ----
  const TASK_STATUS_LABEL = { '': 'None', planned: 'Planned', in_progress: 'In Progress', completed: 'Completed' };
  const SORTS_TASK = [
    { value: 'manual', label: 'Manual' },
    { value: 'importance', label: 'Importance' },
    { value: 'name', label: 'Name (A→Z)' },
    { value: 'name_desc', label: 'Name (Z→A)' }
  ];
  const VIEWS_TASK = [{ value: 'list', label: 'List view' }, { value: 'board', label: 'Board view' }];
  const GROUPS_TASK = [{ value: 'status', label: 'Status' }, { value: 'priority', label: 'Priority' }, { value: 'tag', label: 'Tag' }];
  const IMPORTANCE_GROUPS = [
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
    { key: '', label: 'None' }
  ];
  // Workflow order (not started → done), not the alphabetical facet order.
  const STATUS_GROUPS = ['', 'planned', 'in_progress', 'completed'].map((key) => ({ key, label: TASK_STATUS_LABEL[key] }));
  let taskQuery = $state('');
  let taskFilters = $state({});
  let taskSort = $state('importance');
  let taskView = $state('list');
  let taskGroupBy = $state('status');
  let taskBulkTag = $state('');

  // Remembers the active tab plus each tab's filters/sort/view/group-by per
  // plan on this device (owner only — search text is excluded on purpose, so
  // a stale search term can never silently hide things on the next visit).
  let loadedPlanId = null;
  $effect(() => {
    if (!editing || !planId || loadedPlanId === planId) return;
    loadedPlanId = planId;
    const saved = loadViewPref(planId, 'readiness') || {};
    if (saved.tab) tab = saved.tab;
    if (saved.filters) filters = saved.filters;
    if (saved.testFilters) testFilters = saved.testFilters;
    if (saved.taskFilters) taskFilters = saved.taskFilters;
    if (saved.taskSort) taskSort = saved.taskSort;
    if (saved.taskView) taskView = saved.taskView;
    if (saved.taskGroupBy) taskGroupBy = saved.taskGroupBy;
  });
  $effect(() => {
    if (!editing || !planId || loadedPlanId !== planId) return;
    saveViewPref(planId, 'readiness', {
      tab,
      filters: $state.snapshot(filters),
      testFilters: $state.snapshot(testFilters),
      taskFilters: $state.snapshot(taskFilters),
      taskSort,
      taskView,
      taskGroupBy
    });
  });

  const taskFacets = $derived([
    {
      key: 'status',
      label: 'Status',
      test: (t, v) => (t.status || '') === v,
      options: ['planned', 'in_progress', 'completed', ''].map((v) => ({ value: v, label: TASK_STATUS_LABEL[v], count: tasks.filter((t) => (t.status || '') === v).length })).filter((o) => o.count)
    },
    {
      key: 'importance',
      label: 'Importance',
      test: (t, v) => (t.importance || '') === v,
      options: ['high', 'medium', 'low'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), count: tasks.filter((t) => t.importance === v).length })).filter((o) => o.count)
    },
    {
      key: 'person',
      label: 'Person',
      test: (t, v) => (t.person_ids || []).includes(v),
      options: pkg.people.map((p) => ({ value: p.id, label: pkg.name(p.id), count: tasks.filter((t) => (t.person_ids || []).includes(p.id)).length })).filter((o) => o.count)
    },
    {
      key: 'location',
      label: 'Location',
      test: (t, v) => (t.location_ids || []).includes(v),
      options: pkg.locations.map((l) => ({ value: l.id, label: pkg.name(l.id), count: tasks.filter((t) => (t.location_ids || []).includes(l.id)).length })).filter((o) => o.count)
    },
    {
      key: 'tag',
      label: 'Tag',
      test: (t, v) => (t.tags || []).includes(v),
      options: pkg.allTaskTags().map((t) => ({ value: t, label: '# ' + t, count: pkg.tasksWithTag(t).length }))
    }
  ]);
  const taskMatches = (t) => {
    const q = taskQuery.trim().toLowerCase();
    if (!q) return true;
    return [pkg.name(t.id), t.description, ...(t.person_ids || []).map((id) => pkg.name(id)), ...(t.location_ids || []).map((id) => pkg.name(id)), ...(t.tags || [])]
      .some((x) => String(x || '').toLowerCase().includes(q));
  };
  const taskPasses = (t) => taskFacets.every((f) => {
    const sel = taskFilters[f.key];
    return !sel?.length || sel.some((v) => f.test(t, v));
  });
  function sortTasks(arr) {
    if (taskSort === 'name') return [...arr].sort((a, b) => pkg.name(a.id).localeCompare(pkg.name(b.id)));
    if (taskSort === 'name_desc') return [...arr].sort((a, b) => pkg.name(b.id).localeCompare(pkg.name(a.id)));
    // Manual: a flat order set by dragging, deliberately ignoring importance
    // (Todoist's model — Manual freely interleaves priorities).
    if (taskSort === 'manual') return [...arr].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || pkg.name(a.id).localeCompare(pkg.name(b.id)));
    return arr; // already importance-ordered (highest first) via pkg.tasksOrdered()
  }
  const taskMatchesAndPasses = $derived(tasks.filter((t) => taskMatches(t) && taskPasses(t)));
  // Completed tasks are hidden unless the Status filter explicitly asks for them.
  const taskPool = $derived(taskMatchesAndPasses.filter((t) => (taskFilters.status || []).includes('completed') || t.status !== 'completed'));
  const visibleTasks = $derived(sortTasks(taskPool));
  const taskIds = $derived(visibleTasks.map((t) => t.id));
  // Board columns group the same pool List shows, just bucketed instead of
  // flat — the chosen Sort (including Manual) still applies within each
  // column, same as it does for List's flat order. Tasks with no
  // priority/tag land in a trailing "None" bucket rather than vanishing.
  // Status grouping is the exception: its whole point is to show where work
  // stands, so it doesn't hide Completed the way the other groupings do.
  const taskGroups = $derived.by(() => {
    if (taskGroupBy === 'status') {
      return STATUS_GROUPS.map((g) => ({ ...g, tasks: sortTasks(taskMatchesAndPasses.filter((x) => (x.status || '') === g.key)) }));
    }
    if (taskGroupBy === 'tag') {
      const cols = pkg.allTaskTags().map((t) => ({ key: t, label: '# ' + t, tasks: sortTasks(taskPool.filter((x) => (x.tags || []).includes(t))) }));
      cols.push({ key: '', label: 'None', tasks: sortTasks(taskPool.filter((x) => !(x.tags || []).length)) });
      return cols;
    }
    return IMPORTANCE_GROUPS.map((g) => ({ ...g, tasks: sortTasks(taskPool.filter((x) => (x.importance || '') === g.key)) }));
  });
  // What Board should treat as "any tasks at all" for its empty state —
  // mirrors whichever pool the active grouping actually draws its columns from.
  const taskBoardPool = $derived(taskGroupBy === 'status' ? taskMatchesAndPasses : taskPool);
  // Drag-to-reorder is offered in Manual sort, with no search/filter
  // narrowing the list — same reasoning Todoist uses (Manual is its own
  // sort; dragging is off under any other sort or once filtered). Tag
  // grouping is excluded in Board because a task can sit in more than one
  // tag column at once, so "its" column — and therefore "up/down within it"
  // — isn't well-defined the way it is for the single-valued groupings.
  const canReorderTasks = $derived(
    editing && taskSort === 'manual' && !taskQuery.trim() && !Object.values(taskFilters).some((v) => v?.length) &&
    (taskView === 'list' || taskGroupBy !== 'tag')
  );
  // Board reordering (position within a column) is scoped to the dragged
  // card's own column: it must land among the same group's cards, not
  // anywhere on the board.
  function taskGroupKeyOf(t) {
    if (!t) return null;
    if (taskGroupBy === 'status') return t.status || '';
    return t.importance || '';
  }
  function taskContextList(task) {
    if (taskView !== 'board') return visibleTasks;
    const key = taskGroupKeyOf(task);
    return taskGroups.find((g) => g.key === key)?.tasks || [];
  }
  // Moving a card to a different column is a field edit (status/importance),
  // not a reorder — so it's offered under any sort/filter, same as flipping
  // Status or Importance in the task's own edit panel would be. Tag grouping
  // is excluded: a task can sit in more than one tag column at once, so
  // dropping it in a different tag column has no single well-defined meaning.
  function canDragBoardCard(task) {
    return editing && taskView === 'board' && (taskGroupBy === 'status' || taskGroupBy === 'priority') && !!task;
  }
  function setTaskGroup(task, key) {
    if (taskGroupBy === 'status') task.status = key;
    else if (taskGroupBy === 'priority') task.importance = key || undefined;
  }
  let taskDrag = $state(null);
  let taskDrop = $state(null); // { id, pos: 'before'|'after' } — same-column reorder preview
  let taskDropColumnKey = $state(null); // board: column currently hovered for a cross-column move
  function taskDragStart(e, id) {
    const task = tasks.find((t) => t.id === id);
    if (!canReorderTasks && !canDragBoardCard(task)) return;
    taskDrag = id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
  function taskDragEnd() { taskDrag = null; taskDrop = null; taskDropColumnKey = null; }
  function taskOver(e, task) {
    if (!taskDrag || taskDrag === task.id) return;
    if (taskView === 'board') {
      if (taskGroupBy === 'tag') return;
      const dragged = tasks.find((t) => t.id === taskDrag);
      const targetKey = taskGroupKeyOf(task);
      e.preventDefault(); e.stopPropagation();
      if (taskGroupKeyOf(dragged) !== targetKey) {
        taskDropColumnKey = targetKey;
        taskDrop = null;
        return;
      }
      taskDropColumnKey = null;
      if (!canReorderTasks) return;
    } else {
      if (!canReorderTasks) return;
      e.preventDefault(); e.stopPropagation();
    }
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    taskDrop = { id: task.id, pos: after ? 'after' : 'before' };
  }
  function taskDropOn(e, task) {
    if (!taskDrag) return;
    e.preventDefault(); e.stopPropagation();
    const dragged = tasks.find((t) => t.id === taskDrag);
    if (taskView === 'board' && dragged && taskGroupKeyOf(dragged) !== taskGroupKeyOf(task)) {
      setTaskGroup(dragged, taskGroupKeyOf(task));
      taskDragEnd();
      return;
    }
    if (taskDrop?.id !== task.id) { taskDragEnd(); return; }
    const list = taskContextList(task);
    const idx = list.findIndex((t) => t.id === task.id);
    const beforeId = taskDrop.pos === 'after' ? (list[idx + 1]?.id ?? null) : task.id;
    if (taskDrag !== beforeId) onReorderTask?.(taskDrag, beforeId);
    taskDragEnd();
  }
  // Fallback drop target for empty columns / blank space below the last
  // card — the row-level handlers above cover dropping onto a specific card.
  function taskOverColumnBody(e, key) {
    if (!taskDrag || taskGroupBy === 'tag') return;
    const dragged = tasks.find((t) => t.id === taskDrag);
    if (!dragged || taskGroupKeyOf(dragged) === key) return;
    e.preventDefault();
    taskDropColumnKey = key;
  }
  function taskDropOnColumnBody(e, key) {
    if (!taskDrag || taskGroupBy === 'tag') return;
    e.preventDefault();
    const dragged = tasks.find((t) => t.id === taskDrag);
    if (dragged && taskGroupKeyOf(dragged) !== key) setTaskGroup(dragged, key);
    taskDragEnd();
  }
  function applyTaskBulkTag() {
    const t = taskBulkTag.trim();
    if (!t || !selectedIds.length) return;
    onBulkTaskTag?.(selectedIds, t);
    taskBulkTag = '';
  }
  function taskEmptyLabel() {
    if (taskQuery.trim()) return `No results for "${taskQuery.trim()}".`;
    if (taskMatchesAndPasses.length) return 'All tasks completed.';
    return 'No tasks yet.';
  }

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
  <div class="section-head">
    <h2 class="vh">Readiness</h2>
    {#if editing && tab === 'tasks'}
      <div class="head-actions no-print">
        {#if selectActions}{@render selectActions(taskIds, 'tasks')}{/if}
        <button class="btn btn-small btn-primary" onclick={() => onAddTask?.()}>+ New</button>
      </div>
    {:else if editing && tab === 'questions'}
      <div class="head-actions no-print">
        {#if selectActions}{@render selectActions(ids, 'readiness checks')}{/if}
        <button class="btn btn-small btn-primary" onclick={() => onAdd?.()}>+ New</button>
      </div>
    {:else if tab === 'tests'}
      <div class="head-actions no-print">
        {#if selectedRunIds.length}<button class="btn btn-small del-selected" onclick={deleteSelectedRuns}>Delete selected ({selectedRunIds.length})</button>{/if}
        {#if visibleRunIds.length}<button class="btn btn-small" onclick={toggleAllRuns}>{allRunsSelected ? 'Deselect all' : 'Select all'}</button>{/if}
      </div>
    {/if}
    <span class="print-only tiny print-date">Printed {printDate}</span>
  </div>
  <div class="tabs no-print" role="tablist" aria-label="Readiness views">
    <button class:on={tab === 'tasks'} onclick={() => (tab = 'tasks')}>Tasks</button>
    <button class:on={tab === 'questions'} onclick={() => (tab = 'questions')}>Questions</button>
    <button class:on={tab === 'tests'} onclick={() => (tab = 'tests')}>Dry runs</button>
  </div>

  {#if tab === 'tasks'}
    {#if tasks.length}
      <FilterBar
        facets={taskFacets} sorts={SORTS_TASK} bind:filters={taskFilters} bind:sort={taskSort} bind:search={taskQuery}
        views={VIEWS_TASK} bind:view={taskView} groups={GROUPS_TASK} bind:group={taskGroupBy}
        placeholder="Search tasks…"
      />
    {/if}

    {#if editing && selectedIds.length}
      <div class="bulk-tag no-print">
        <span class="tiny muted">Tag {selectedIds.length} selected:</span>
        <input class="bulk-input" list="task-tags" bind:value={taskBulkTag} placeholder="e.g. bitcoin, annual-review" onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), applyTaskBulkTag())} />
        <datalist id="task-tags">{#each pkg.allTaskTags() as t}<option value={t}></option>{/each}</datalist>
        <button class="btn btn-small" onclick={applyTaskBulkTag} disabled={!taskBulkTag.trim()}>Add tag</button>
      </div>
    {/if}

    {#snippet taskMeta(task)}
      <span class="readiness-meta">
        {#if task.status && !(taskView === 'board' && taskGroupBy === 'status')}<span class="chip">{TASK_STATUS_LABEL[task.status]}</span>{/if}
        {#if (task.person_ids || []).length}<span class="chip">{(task.person_ids || []).map((id) => pkg.name(id)).join(', ')}</span>{/if}
        {#if (task.location_ids || []).length}<span class="chip">{(task.location_ids || []).map((id) => pkg.name(id)).join(', ')}</span>{/if}
        {#if task.tags?.length && !(taskView === 'board' && taskGroupBy === 'tag')}{#each task.tags as t}<span class="row-tag"># {t}</span>{/each}{/if}
      </span>
    {/snippet}

    {#snippet taskRow(task)}
      {@const idx = taskIds.indexOf(task.id)}
      <div
        class="ulist-row"
        class:task-before={taskDrop?.id === task.id && taskDrop.pos === 'before'}
        class:task-after={taskDrop?.id === task.id && taskDrop.pos === 'after'}
        class:dragging={taskDrag === task.id}
        draggable={canDragBoardCard(task) || (canReorderTasks && task.status !== 'completed')}
        ondragstart={(e) => taskDragStart(e, task.id)}
        ondragend={taskDragEnd}
        ondragover={(e) => taskOver(e, task)}
        ondrop={(e) => taskDropOn(e, task)}
        role="presentation"
      >
        {#if editing}<input type="checkbox" class="rowcheck no-print" checked={selectedIds.includes(task.id)} onclick={(e) => onSelect?.(taskIds, idx, e)} aria-label="Select" />{/if}
        {#if canDragBoardCard(task) || (canReorderTasks && task.status !== 'completed')}<span class="grip task-grip no-print" title="Drag to move" aria-hidden="true">⠿</span>{/if}
        <button class="ulist-click" onclick={() => onOpen?.(task.id)}>
          <span class="ulist-main">
            <span class="ulist-name">{pkg.name(task.id)}</span>
            {#if task.description && taskView !== 'board'}<span class="ulist-desc">{markdownPreview(task.description, resolveRef)}</span>{/if}
            {#if taskView !== 'board'}{@render taskMeta(task)}{/if}
          </span>
        </button>
        <span class="ulist-aside">
          {#if !(taskView === 'board' && taskGroupBy === 'priority')}<Importance level={task.importance} compact />{/if}
          {#if editing}<button class="rowdel no-print" title="Delete" aria-label="Delete" onclick={() => onDelete?.(task.id)}><TrashIcon /></button>{/if}
        </span>
        {#if taskView === 'board'}{@render taskMeta(task)}{/if}
      </div>
    {/snippet}

    {#if taskView === 'board'}
      {#if taskBoardPool.length}
        <div class="board">
          {#each taskGroups as g (g.key)}
            <div class="board-col" class:drop-target={taskDropColumnKey === g.key}>
              <div class="board-col-head"><span>{g.label}</span><span class="board-col-count">{g.tasks.length}</span></div>
              <div
                class="board-col-body"
                ondragover={(e) => taskOverColumnBody(e, g.key)}
                ondrop={(e) => taskDropOnColumnBody(e, g.key)}
                role="presentation"
              >
                {#each g.tasks as task (task.id)}
                  {@render taskRow(task)}
                {:else}
                  <p class="board-col-empty">No tasks.</p>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-results">{taskEmptyLabel()}</p>
      {/if}
    {:else}
      <div class="ulist">
        {#each visibleTasks as task (task.id)}
          {@render taskRow(task)}
        {:else}
          <p class="empty-results">{taskEmptyLabel()}</p>
        {/each}
      </div>
    {/if}
  {:else if tab === 'questions'}
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
              <span class="ulist-desc">{markdownPreview(check.question, resolveRef) || 'Dry-run question'}</span>
              <span class="readiness-meta">
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
      <FilterBar facets={testFacets} bind:filters={testFilters} bind:search={testQuery} placeholder="Search dry runs…" />
    {/if}
    <div class="ulist">
      {#each visibleRuns as run (run.id)}
        <div class="ulist-row run-row">
          <input type="checkbox" class="rowcheck no-print" checked={selectedRunIds.includes(run.id)} onclick={() => toggleRun(run.id)} aria-label="Select dry run" />
          <span class="list-row-ico" aria-hidden="true"><Icon kind="readiness" /></span>
          <button class="ulist-click" onclick={() => onOpenRun?.(run.id)}>
            <span class="ulist-main">
              <span class="ulist-name">{testName(run)}</span>
              <span class="ulist-desc">{runPerson(run)} · {(run.results || []).length} result{(run.results || []).length === 1 ? '' : 's'}{#if run.duration_ms} · {durationLabel(run.duration_ms)}{/if}</span>
            </span>
          </button>
          <span class="ulist-aside">
            <button class="rowdel no-print" title="Delete dry run" aria-label="Delete dry run" onclick={() => onDeleteRun?.(run.id)}><TrashIcon /></button>
          </span>
        </div>
      {:else}
        <p class="empty-results">{testQuery.trim() ? `No dry runs for "${testQuery.trim()}".` : 'No dry runs yet.'}</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .readiness { display: flex; flex-direction: column; gap: 14px; }
  /* Same top-right "Printed <date>" corner as the other list views (see
     Reader.svelte's .print-date) — anchored to .readiness itself since
     .section-head can't be relied on to keep its flex row at print time. */
  @media print {
    .readiness { position: relative; }
    .print-date { position: absolute; top: 0; right: 0; }
  }
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
  .readiness-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
  .readiness-meta .chip { max-width: 100%; }
  .task-grip { flex: none; padding: 2px 3px; color: var(--ink-mute); opacity: 0.5; cursor: grab; touch-action: none; }
  .task-grip:hover { opacity: 1; color: var(--accent-deep); }
  .ulist-row[draggable='true']:active { cursor: grabbing; }
  .ulist-row.dragging { opacity: 0.4; }
  .ulist-row.task-before { box-shadow: inset 0 2px 0 var(--accent-deep); }
  .ulist-row.task-after { box-shadow: inset 0 -2px 0 var(--accent-deep); }
  .bulk-tag { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 4px; padding: 10px 12px; background: var(--accent-wash); border-radius: 9px; }
  .bulk-input { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; background: var(--paper); color: var(--ink); }
  .bulk-input:focus { outline: none; border-color: var(--accent-deep); }
  .row-tag { font-size: 11px; color: var(--accent-deep); background: var(--accent-wash); border-radius: 5px; padding: 1px 6px; }
  .board { display: flex; align-items: flex-start; gap: 14px; overflow-x: auto; padding-bottom: 8px; }
  .board-col { flex: 0 0 300px; background: var(--accent-wash); border-radius: 10px; overflow: hidden; }
  .board-col.drop-target { box-shadow: inset 0 0 0 2px var(--accent-deep); }
  .board-col-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; font-size: 13px; font-weight: 500; color: var(--ink-soft); }
  .board-col-count { font-size: 11px; color: var(--ink-mute); }
  .board-col-body { display: flex; flex-direction: column; gap: 0; background: var(--paper); min-height: 8px; }
  .board-col-body .ulist-row { border-left: 0; border-right: 0; align-items: flex-start; flex-wrap: wrap; }
  /* Board cards: the meta chip sits outside the title button as its own
     full-width line, so it can use the whole card width instead of being
     squeezed into the title column alongside the checkbox/grip/trash gutters. */
  .ulist-row > .readiness-meta { flex-basis: 100%; min-width: 0; }
  .board-col-body .rowcheck { margin-top: 2px; }
  .board-col-body .ulist-aside { margin-top: 2px; }
  .board-col-empty { padding: 10px 16px 14px; font-size: 13px; color: var(--ink-mute); }
</style>
