<script>
  // Importance as a plain text label — accessible, no reliance on colour.
  let { level } = $props();
  const MAP = { high: 'High', medium: 'Medium', low: 'Low' };
  const label = $derived(MAP[level]);
</script>

{#if label}
  <span class="imp" title={'Importance: ' + label}>[{label}]</span>
{/if}

<style>
  .imp { font-size: 12px; color: var(--ink-mute); white-space: nowrap; }
</style>
