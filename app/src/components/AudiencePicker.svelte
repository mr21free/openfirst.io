<script>
  /*
    Modal companion to the rail's "Reading as" button — same shape as
    DryRunPicker, plus an admin/"see everything" option since switching the
    reading view isn't limited to people with readiness checks.
  */
  import Icon from './Icon.svelte';
  import { lockBodyScroll } from '../lib/scrollLock.js';

  let { pkg, primary = [], rest = [], adminLabel, onPick, onAdmin, onCancel } = $props();

  $effect(() => lockBodyScroll());

  function onKeydown(e) { if (e.key === 'Escape') onCancel?.(); }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scrim" role="presentation" onclick={() => onCancel?.()}></div>
<div class="card" role="dialog" aria-modal="true" aria-label="Choose who you're reading as">
  <p class="eyebrow">Reading as</p>
  <h3>Whose view do you want to see?</h3>
  <p class="soft small">The plan shows only what that person is meant to see.</p>
  {#snippet whoBtn(p)}
    <button class="who" onclick={() => onPick(p.id)}>
      <span class="who-ico" aria-hidden="true"><Icon kind="person" /></span>
      <span class="who-main">
        <span class="who-name">{pkg.name(p.id)}{#if p.nickname} <span class="muted small">· {p.name}</span>{:else if p.display_as} <span class="muted small">· {p.display_as}</span>{/if}</span>
        <span class="row wrap">{#each p.roles as r}<span class="chip">{pkg.roleLabel(r)}</span>{/each}</span>
      </span>
    </button>
  {/snippet}
  <div class="picker-people">
    {#each primary as p}{@render whoBtn(p)}{/each}
    {#if primary.length && rest.length}<div class="picker-sep" aria-hidden="true"></div>{/if}
    {#each rest as p}{@render whoBtn(p)}{/each}
  </div>
  <div class="picker-actions">
    <button class="btn btn-ghost" onclick={() => onAdmin()}>{adminLabel}</button>
    <button class="btn btn-ghost" onclick={() => onCancel?.()}>Cancel</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-scrim); }
  .card {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: var(--z-modal); width: min(440px, 94vw);
    border: 1px solid var(--rule); border-left: 2px solid var(--accent);
    border-radius: 0; background: var(--paper);
    box-shadow: 0 24px 60px oklch(0.2 0.03 255 / 0.14);
    padding: 30px 32px;
  }
  .card h3 { font-size: 19px; margin: 6px 0 8px; }
  .picker-people { display: grid; gap: 6px; margin: 18px 0; max-height: 50vh; overflow-y: auto; }
  .picker-sep { height: 1px; background: var(--rule-soft); margin: 2px 0; }
  .who {
    display: flex; gap: 12px; align-items: flex-start;
    border: 0; border-radius: 0; padding: 10px 10px; text-align: left;
    transition: background .12s;
  }
  .who:hover { background: var(--accent-wash); }
  .who-ico {
    flex: none; width: 28px; height: 28px; border-radius: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-soft); background: var(--accent-wash);
  }
  .who-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .who-name { font-size: 15px; font-weight: 500; }
  .picker-actions { display: flex; justify-content: flex-start; gap: 8px; }
</style>
