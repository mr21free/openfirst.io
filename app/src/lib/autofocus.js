// Drawer.svelte slides its card in over 180ms (transform: translateX -> none).
// Focusing an input while that transform is still animating is what causes
// iOS Safari to misplace the caret after the first few characters are typed
// — it snapshots the caret's position against the mid-animation transform.
// Waiting until just after the slide finishes avoids it.
export function deferFocus(el, delay = 220) {
  if (!el) return () => {};
  const t = setTimeout(() => el.focus(), delay);
  return () => clearTimeout(t);
}
