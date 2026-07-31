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

import { mkdirSync, copyFileSync, renameSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APP_VERSION } from '../src/lib/version.js';

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

// Stamp every static page's "Download" link filename with the real version —
// the linked URL itself stays stable across releases (see below), only the
// suggested save-as name needs the version baked in. The homepage comes from
// site/ (just copied above); the rest are public/ pages Vite already copied
// into dist/ verbatim, so __APP_VERSION__ still needs stamping here — it's
// never substituted at the public/ source, since anything left there would
// ship the literal placeholder text on any page this script doesn't touch.
const stampedPages = [
  'index.html',
  'guides/index.html',
  '404.html',
  'guides/trusted-helper-protocol/index.html',
  'how-to-use/index.html',
  'guides/dry-run/index.html',
  'guides/bitcoin-inheritance-runbook/index.html',
  'guides/first-72-hours/index.html',
  'security/index.html'
];
for (const page of stampedPages) {
  const out = resolve(dist, page);
  writeFileSync(out, readFileSync(out, 'utf8').replace(/__APP_VERSION__/g, APP_VERSION));
}

// A stable, permanent download of the app itself — the built app is already
// one self-contained file (see the /build/ copy above), so "downloading the
// app" is just handing out that same file under its own stable URL. Kept
// separate from /build/ (which is a live app boot mode, not a download).
mkdirSync(resolve(dist, 'download'), { recursive: true });
copyFileSync(resolve(dist, 'build', 'index.html'), resolve(dist, 'download', 'openfirst.html'));

// The one thing the in-app "check for updates" button ever fetches.
writeFileSync(resolve(dist, 'version.json'), JSON.stringify({ version: APP_VERSION }));

console.log(`postbuild: / (home) · /build/ · /open/ · /demo/ · /download/ ready — v${APP_VERSION}`);
