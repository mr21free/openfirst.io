<script>
  import EntityPicker from './EntityPicker.svelte';
  import GuideContentEditor from './GuideContentEditor.svelte';
  import StatusIcon from './StatusIcon.svelte';
  import TagInput from './TagInput.svelte';
  import TrashIcon from './TrashIcon.svelte';

  let { pkg, store = null, raw, onDelete } = $props();

  const runResults = $derived.by(() => {
    if (!raw?.id) return [];
    return (store?.data?.readiness_runs || [])
      .map((run) => ({ run, result: (run.results || []).find((r) => r.check_id === raw.id) }))
      .filter((r) => r.result)
      .sort((a, b) => {
        const at = Date.parse(a.run.submitted_at || a.run.started_at || a.run.date || '');
        const bt = Date.parse(b.run.submitted_at || b.run.started_at || b.run.date || '');
        if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
        return String(b.run.date || '').localeCompare(String(a.run.date || ''));
      });
  });
  function testerName(run) {
    return run.person_id ? pkg.name(run.person_id) : 'Admin';
  }
  function testName(run) {
    const iso = run?.submitted_at || run?.started_at;
    if (!iso) return run?.date || 'No date';
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (_) {
      return `${run?.date || 'No date'} ${String(iso).slice(11, 16)}`;
    }
  }
  function deleteResult(runId, checkId) {
    store?.deleteReadinessResult?.(runId, checkId);
  }
</script>

{#if raw}
  <div class="frm">
    <label class="f"><span class="lbl">Name</span><input bind:value={raw.title} placeholder="e.g. Find the inheritance package" /></label>
    <label class="f"><span class="lbl">Importance</span>
      <select bind:value={raw.importance}><option value={undefined}>—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    </label>
    <label class="toggle">
      <input type="checkbox" checked={raw.scope === 'internal'} onchange={(e) => raw.scope = e.target.checked ? 'internal' : 'external'} />
      <span>Internal - hide during dry run</span>
    </label>

    {#if raw.scope === 'internal'}
      <div class="f"><span class="lbl">Task / gap</span>
        <GuideContentEditor {pkg} {raw} compact value={raw.owner_notes || ''} onValue={(v) => raw.owner_notes = v} placeholder="e.g. Update the Bitcoin guide because Amanda did not know where to start." />
      </div>
    {:else}
      <div class="f"><span class="lbl">Question / task</span>
        <GuideContentEditor {pkg} {raw} compact value={raw.question || ''} onValue={(v) => raw.question = v} placeholder="e.g. If I am gone, where do you find the inheritance package?" />
      </div>
      <label class="f"><span class="lbl">What a good answer proves</span><textarea rows="3" bind:value={raw.expected} placeholder="e.g. Amanda knows the USB is in the home safe and who has the password."></textarea></label>
      <div class="f"><span class="lbl">Assigned people</span><EntityPicker {pkg} target={raw} key="person_ids" kinds={['person']} placeholder="Add a person…" /></div>
      <label class="f"><span class="lbl">Owner notes</span><textarea rows="3" bind:value={raw.owner_notes} placeholder="Private context for improving the plan."></textarea></label>
    {/if}

    <div class="f"><span class="lbl">Tags</span>
      <TagInput target={raw} key="tags" suggestions={pkg.allReadinessTags()} placeholder="e.g. bitcoin, annual-review…" />
    </div>
    <div class="f"><span class="lbl">Related people</span><EntityPicker {pkg} target={raw} key="related_person_ids" kinds={['person']} placeholder="Add a person…" /></div>
    <div class="f"><span class="lbl">Related items</span><EntityPicker {pkg} target={raw} key="related_item_ids" kinds={['item']} placeholder="Add an item…" /></div>
    <div class="f"><span class="lbl">Related locations</span><EntityPicker {pkg} target={raw} key="related_location_ids" kinds={['location']} placeholder="Add a location…" /></div>
    <div class="f"><span class="lbl">Related guides</span><EntityPicker {pkg} target={raw} key="related_guide_ids" kinds={['guide']} placeholder="Add a guide…" /></div>
    <div class="f"><span class="lbl">Related files</span><EntityPicker {pkg} target={raw} key="related_attachment_ids" kinds={['attachment']} placeholder="Add a file…" /></div>

    <div class="f results-field"><span class="lbl">Dry-run results</span>
      {#if runResults.length}
        <div class="result-list">
          {#each runResults as rr (rr.run.id)}
            <div class="result-row">
              <StatusIcon status={rr.result.status} wrapped />
              <div class="result-main">
                <span class="muted small">{testerName(rr.run)} · {testName(rr.run)}</span>
                {#if rr.result.notes}<p class="soft small">{rr.result.notes}</p>{/if}
              </div>
              <button class="mini-clear" title="Delete answer" aria-label="Delete answer" onclick={() => deleteResult(rr.run.id, rr.result.check_id)}><TrashIcon size={12} /></button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="soft small">No dry-run results yet.</p>
      {/if}
    </div>

    <div class="form-foot"><button class="btn btn-ghost form-danger" onclick={() => onDelete?.()}>Delete</button></div>
  </div>
{/if}

<style>
  textarea {
    width: 100%;
    min-height: 78px;
    resize: vertical;
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 0;
    padding: 9px 10px;
  }
  .results-field { border-top: 1px solid var(--rule-soft); padding-top: 14px; }
  .result-list { display: flex; flex-direction: column; gap: 8px; }
  .result-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    column-gap: 14px;
    align-items: center;
    padding: 6px 0;
  }
  .result-main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .result-row p { margin: 0; white-space: pre-wrap; }
  .mini-clear { flex: none; align-self: center; color: var(--warn); border: 1px solid var(--rule); padding: 5px 8px; font-size: 12px; }
  .mini-clear:hover { border-color: var(--warn); background: var(--warn-wash); }
</style>
