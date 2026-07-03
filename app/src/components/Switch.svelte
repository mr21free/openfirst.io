<script>
  /*
    The app's on/off control (see DESIGN.md → Switch). A visual pill switch
    with proper switch semantics. The parent owns the state: `checked` is what
    the switch SHOWS; `onToggle(next)` is the intent — the parent may complete
    it asynchronously (e.g. only flip to "on" after a passphrase is set).
  */
  let { checked = false, onToggle, label, disabled = false } = $props();
</script>

<button
  class="switch"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onToggle?.(!checked)}
>
  <span class="knob"></span>
</button>
