<script>
  import Prose from './Prose.svelte';
  import StatusIcon from './StatusIcon.svelte';
  import Callout from './Callout.svelte';
  import { lockBodyScroll } from '../lib/scrollLock.js';

  let { pkg, store, runId, personId = null, adminLabel = 'Admin', onSubmit = null, onCancel = null } = $props();
  let full = $state(false);

  $effect(() => lockBodyScroll());

  const person = $derived(personId ? pkg.entity(personId)?.obj : null);
  const run = $derived((store.data?.readiness_runs || []).find((r) => r.id === runId) || null);
  const checks = $derived(pkg.readinessOrdered().filter(applies));

  function applies(check) {
    if ((check.scope || 'external') !== 'external') return false;
    if (!personId) return true;
    if ((check.person_ids || []).includes(personId)) return true;
    if ((check.role_ids || []).some((r) => (person?.roles || []).includes(r))) return true;
    return !(check.person_ids || []).length && !(check.role_ids || []).length;
  }
  function resultFor(checkId) {
    return run?.results?.find((r) => r.check_id === checkId) || { status: '', notes: '' };
  }
  function setStatus(checkId, status) {
    store.setReadinessResult(runId, checkId, { status });
  }
  function setNotes(checkId, notes) {
    store.setReadinessResult(runId, checkId, { notes });
  }
  const doneCount = $derived(checks.filter((c) => ['pass', 'not_sure', 'fail'].includes(resultFor(c.id).status)).length);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onCancel?.()} />

<div class="dryrun no-print" class:full role="dialog" aria-label="Dry run">
  <div class="dhead">
    <div class="dhead-main">
      <span class="eyebrow">Dry run</span>
      <h2>{person ? pkg.name(person.id) : adminLabel}</h2>
      <p class="tiny muted">{doneCount}/{checks.length} checked</p>
    </div>
    <div class="dhead-actions">
      <button class="iconbtn expand-toggle" onclick={() => (full = !full)} data-tip={full ? 'Shrink panel' : 'Expand panel'} data-tip-pos="left" aria-label={full ? 'Shrink panel' : 'Expand panel'}>
        {#if full}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
        {/if}
      </button>
      <button class="iconbtn" onclick={() => onCancel?.()} data-tip="Close" data-tip-pos="left" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  </div>
  <Callout text="Do not type PINs, passwords, seed words, passphrases, or private keys here." tone="warning" />

  {#if checks.length}
    <div class="dry-list">
      {#each checks as check, i (check.id)}
        {@const result = resultFor(check.id)}
        <div class="dry-card">
          <div class="dry-section">
            <span class="dry-number">{i + 1}</span>
            {#if check.question}<div class="dry-prose"><Prose {pkg} markdown={check.question} /></div>{:else}<p class="soft small">No question written yet.</p>{/if}
          </div>
          <div class="dry-section">
            <span class="dry-label">Answer</span>
            <div class="dry-buttons">
              <button class="iconbtn" class:on={result.status === 'pass'} onclick={() => setStatus(check.id, 'pass')} data-tip="Done / found it" aria-label="Done / found it"><StatusIcon status="pass" size={18} /></button>
              <button class="iconbtn" class:on={result.status === 'not_sure'} onclick={() => setStatus(check.id, 'not_sure')} data-tip="Not sure" aria-label="Not sure"><StatusIcon status="not_sure" size={18} /></button>
              <button class="iconbtn" class:on={result.status === 'fail'} onclick={() => setStatus(check.id, 'fail')} data-tip="Could not do it" aria-label="Could not do it"><StatusIcon status="fail" size={18} /></button>
            </div>
            <textarea
              rows="3"
              value={result.notes || ''}
              placeholder="What happened? What was unclear? Do not enter secrets."
              oninput={(e) => setNotes(check.id, e.target.value)}
            ></textarea>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="soft small">No dry-run checks apply to this reader yet.</p>
  {/if}
  <div class="dry-done"><button class="btn btn-small btn-primary" onclick={() => onSubmit?.()}>Submit</button></div>
</div>

<style>
  .dryrun {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 58;
    width: clamp(380px, 38vw, 560px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 22px 60px;
    border-left: 1px solid var(--rule);
    background: var(--paper);
    box-shadow: -24px 0 60px oklch(0.2 0.03 255 / 0.16);
    overflow: auto;
    animation: slide .18s ease;
    transition: width .2s ease;
  }
  .dryrun.full { width: 94vw; }
  @keyframes slide { from { transform: translateX(20px); opacity: .6; } to { transform: none; opacity: 1; } }
  .dhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dhead-main { min-width: 0; }
  .dhead h2 { margin-top: 4px; font-size: 24px; }
  .dhead-main p { margin-top: 6px; }
  .dhead-actions { display: flex; align-items: center; gap: 6px; flex: none; }
  .dry-done { padding-top: 12px; display: flex; justify-content: flex-end; border-top: 1px solid var(--rule-soft); }
  .dry-list { display: grid; gap: 18px; }
  .dry-card { display: grid; gap: 11px; padding: 0 0 16px; border-bottom: 1px solid var(--rule-soft); }
  .dry-card:last-child { border-bottom: none; }
  .dry-section { display: grid; gap: 6px; }
  .dry-number { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rule); color: var(--ink-mute); font-size: 12px; }
  .dry-label { color: var(--ink-mute); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .dry-prose :global(.prose) { font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .dry-prose :global(.prose) :global(p:first-child) { margin-top: 0; }
  .dry-prose :global(.prose) :global(p:last-child) { margin-bottom: 0; }
  .dry-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
  /* Status buttons use the global .iconbtn (bare) — see DESIGN.md. */
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 54px;
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--rule);
    border-radius: 0;
    color: var(--ink);
    background: var(--paper);
    padding: 8px;
  }
  @media (max-width: 860px) {
    /* Base rule pins top/bottom with no explicit height, so leaving `top`
       unset here (as a bottom-sheet-style panel would) sizes the box to its
       content, gets capped by max-height, and settles ~30vh down the screen
       — overlapping the topbar/guide instead of opening from the corner.
       Anchoring top:0 with the same bottom:0 as desktop keeps it full-height
       and flush with the viewport's top-right, just without the side border. */
    .dryrun {
      left: 0;
      right: 0;
      width: auto;
      top: 0;
      max-height: none;
      border-left: none;
      border-top: none;
    }
    /* Panel is already full-width/height on mobile (see above), so the
       desktop-only expand toggle has nothing left to do. */
    .expand-toggle { display: none; }
  }
</style>
