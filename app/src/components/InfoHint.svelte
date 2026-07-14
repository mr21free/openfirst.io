<script>
  // A small "i" affordance that reveals extra explanation on hover/focus — the
  // reusable pattern for documenting a property without cluttering the form.
  // pos="left" is for icons that sit near a panel's right edge (mirrors the
  // app's data-tip-pos="left" convention) so the bubble opens leftward
  // instead of clipping off-screen.
  let { text = '', label = 'More information', pos = 'right' } = $props();
</script>

<span class="info">
  <button type="button" class="info-btn" aria-label={label}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  </button>
  <span class="info-pop" class:pos-left={pos === 'left'} role="tooltip">{text}</span>
</span>

<style>
  .info { position: relative; display: inline-flex; vertical-align: middle; margin-left: 5px; }
  .info-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 999px; padding: 0;
    color: var(--ink-mute); border: none; background: none; cursor: pointer;
  }
  .info-btn:hover, .info-btn:focus-visible { color: var(--accent-deep); }
  /* Anchored to the icon's left edge so it extends rightward — help icons sit
     near the left of a label, where a centred tooltip would clip off-panel. */
  .info-pop {
    position: absolute; bottom: calc(100% + 9px); left: -2px;
    z-index: 70; width: max-content; max-width: 260px;
    background: var(--ink); color: var(--paper);
    font-size: 12px; line-height: 1.5; font-weight: 400; letter-spacing: normal; text-transform: none;
    padding: 8px 11px; border-radius: 8px; text-align: left;
    box-shadow: 0 10px 30px oklch(0.2 0.03 255 / 0.28);
    opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility .12s ease;
    pointer-events: none;
  }
  .info-pop::after {
    content: ''; position: absolute; top: 100%; left: 9px;
    border: 5px solid transparent; border-top-color: var(--ink);
  }
  /* Anchored to the icon's right edge instead, opening leftward. */
  .info-pop.pos-left { left: auto; right: -2px; }
  .info-pop.pos-left::after { left: auto; right: 9px; }
  .info:hover .info-pop, .info-btn:focus-visible + .info-pop { opacity: 1; visibility: visible; }
</style>
