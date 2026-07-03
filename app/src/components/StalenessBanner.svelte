<script>
  /*
    A calm, owner-only nudge (edit mode) when the plan is going stale: it hasn't
    been touched in a while, or it's never been tested with the person meant to
    use it. Stale plans are false comfort — this turns "I set it up once" into a
    prompt to review. Dismissible for the session.
  */
  let { store, onReview } = $props();

  let dismissed = $state(false);

  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const monthsSince = (d) => {
    const t = d ? Date.parse(d) : NaN;
    return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / MONTH);
  };

  const updatedMonths = $derived(monthsSince(store.data?.package?.updated));
  const lastRunDate = $derived.by(() => {
    const runs = store.data?.readiness_runs || [];
    let best = null;
    for (const r of runs) { if (r.date && (!best || r.date > best)) best = r.date; }
    return best;
  });
  const runMonths = $derived(lastRunDate ? monthsSince(lastRunDate) : null);
  // Only nag "never tested" once the plan has some substance and a little age —
  // don't scold a brand-new, still-being-built plan.
  const hasSubstance = $derived(
    (store.data?.people?.length || 0) + (store.data?.items?.length || 0) >= 5 &&
    (store.data?.guides?.length || 0) >= 1
  );
  const createdMonths = $derived(monthsSince(store.data?.package?.created));
  const neverTested = $derived(
    (store.data?.readiness_runs || []).length === 0 &&
    hasSubstance &&
    (createdMonths == null || createdMonths >= 3)
  );

  // Nudge if untouched > 6 months, never dry-run (with substance), or last dry-run > 12 months.
  const stale = $derived(
    (updatedMonths != null && updatedMonths >= 6) ||
    neverTested ||
    (runMonths != null && runMonths >= 12)
  );

  const reasons = $derived.by(() => {
    const r = [];
    if (updatedMonths != null && updatedMonths >= 6) r.push(`last changed ${updatedMonths} month${updatedMonths === 1 ? '' : 's'} ago`);
    if (neverTested) r.push('has never been tested with the person who’d use it');
    else if (runMonths != null && runMonths >= 12) r.push(`was last dry-run ${runMonths} months ago`);
    return r;
  });
</script>

{#if stale && !dismissed}
  <div class="stalebar no-print" role="status">
    <span class="stale-txt">
      <strong>Time for a review.</strong>
      This plan {reasons.join(' · ')}. Accounts, wallets, people, and places change — a plan that’s
      drifted is false comfort. Skim it, update what moved, and test it with the person who’d use it.
    </span>
    <span class="stale-actions">
      {#if onReview}<button class="btn btn-small" onclick={() => onReview()}>Open readiness</button>{/if}
      <button class="stale-x" title="Dismiss for now" aria-label="Dismiss" onclick={() => (dismissed = true)}>✕</button>
    </span>
  </div>
{/if}

<style>
  .stalebar {
    display: flex; gap: 14px; align-items: flex-start; justify-content: space-between;
    padding: 9px 18px; font-size: 13px; line-height: 1.45;
    background: var(--accent-wash); color: var(--ink-soft);
    border-bottom: 1px solid var(--rule);
  }
  .stale-txt strong { color: var(--ink); margin-right: 4px; }
  .stale-actions { display: inline-flex; gap: 8px; align-items: center; flex: none; }
  .stale-x { font-size: 13px; color: var(--ink-mute); background: none; border: none; cursor: pointer; padding: 4px; }
  .stale-x:hover { color: var(--ink); }
</style>
