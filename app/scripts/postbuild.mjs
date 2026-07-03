/*
  Split the built site into its final information architecture:

    /                the static marketing home (site/index.html)
    /build/          the app (drafts + builder) — the self-contained file
    /open/           the same app, boots straight to "open a plan"
    /demo/           the same app, boots straight into the demo plan

  Vite (+ singlefile) emits the app as dist/index.html. This script moves it
  into the three app paths (same file — the app picks its boot mode from
  location.pathname at runtime) and puts the marketing page at the root.
  Static assets in public/ (fonts, /how-to-use/, /security/, icons, samples)
  are already in dist/ and shared by every page.
*/

import { mkdirSync, copyFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const app = resolve(dist, 'index.html');
const home = resolve(root, 'site', 'index.html');

if (!existsSync(app)) {
  console.error('postbuild: dist/index.html not found — run vite build first.');
  process.exit(1);
}

// Vite rewrites the favicon links relative to the page, so each app copy needs
// the icons next to it (also keeps file:// runs of the built file warning-free).
const icons = ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'];

for (const dir of ['build', 'open', 'demo']) {
  mkdirSync(resolve(dist, dir), { recursive: true });
  copyFileSync(app, resolve(dist, dir, 'index.html'));
  for (const icon of icons) {
    if (existsSync(resolve(dist, icon))) copyFileSync(resolve(dist, icon), resolve(dist, dir, icon));
  }
}
renameSync(app, resolve(dist, 'build', 'index.html')); // last copy wins; root freed

copyFileSync(home, resolve(dist, 'index.html'));
console.log('postbuild: / (home) · /build/ · /open/ · /demo/ ready');
