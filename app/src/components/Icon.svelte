<script>
  import { iconSvg } from '../lib/icons.js';
  // A small, controlled type icon. `kind` selects the glyph (person, item,
  // location, guide, file, pdf, image, map, …). Colour comes from currentColor.
  let { kind = 'item', size = 16 } = $props();
</script>

{@html iconSvg(kind, size)}
