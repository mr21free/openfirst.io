<script>
  /*
    The heir's "who are you?" screen — the first thing a reader sees. Picking a
    person tailors what the plan shows; the admin option reveals everything.
    Kept as its own component so the Reader shell stays focused on the plan
    views. Purely presentational: all state lives in the parent.
  */
  import Icon from './Icon.svelte';

  let { pkg, owner, primary = [], rest = [], adminLabel, onChoose, onAdmin } = $props();
</script>

<div class="gate">
  <p class="eyebrow">Before we begin</p>
  <h1 class="gate-h">Take your time.</h1>
  <p class="soft">This plan was prepared by <strong>{owner?.name || 'the owner'}</strong>. So it can show you the right things first — who are you?</p>
  {#snippet whoBtn(p)}
    <button class="who" onclick={() => onChoose(p.id)}>
      <span class="who-ico" aria-hidden="true"><Icon kind="person" /></span>
      <span class="who-main">
        <span class="who-name">{pkg.name(p.id)}{#if p.nickname} <span class="muted small">· {p.name}</span>{:else if p.display_as} <span class="muted small">· {p.display_as}</span>{/if}</span>
        <span class="row wrap">{#each p.roles as r}<span class="chip">{pkg.roleLabel(r)}</span>{/each}</span>
      </span>
    </button>
  {/snippet}
  <div class="gate-people">
    {#each primary as p}{@render whoBtn(p)}{/each}
    {#if primary.length && rest.length}<div class="gate-sep" aria-hidden="true"></div>{/if}
    {#each rest as p}{@render whoBtn(p)}{/each}
  </div>
  <button class="btn btn-ghost" onclick={() => onAdmin()}>{adminLabel}</button>
</div>

<style>
  /* Flush with the rail and content edges — no card box, no centering gutter
     — same "auto-generated page" treatment as the heir's access-path pane. */
  .gate { border: 0; border-left: 2px solid var(--accent); padding: 34px 36px; flex: 1; }
  .gate-h { font-size: clamp(26px, 4vw, 38px); margin: 8px 0 14px; }
  .gate-people { display: grid; gap: 12px; margin: 22px 0; }
  .gate-sep { height: 1px; background: var(--rule-soft); margin: 2px 0; }
  .who {
    display: flex; gap: 12px; align-items: flex-start;
    border: 0; border-radius: 0; padding: 13px 14px; text-align: left;
    transition: border-color .12s, background .12s;
  }
  .who:hover { background: var(--accent-wash); }
  .who-ico {
    flex: none; width: 30px; height: 30px; border-radius: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-soft); background: var(--accent-wash);
  }
  .who-main { min-width: 0; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .who-name { font-size: 17px; font-weight: 500; }
</style>
