import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Strict CSP for the PRODUCTION single file only. Everything is inlined there,
// so 'unsafe-inline' covers our own bundle while connect-src 'none' guarantees a
// tampered package can never exfiltrate anything. Not applied in dev (Vite needs
// the network for its client + HMR).
const PROD_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "font-src data:; img-src 'self' data: blob:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

function injectCspOnBuild() {
  return {
    name: 'inject-csp-on-build',
    apply: 'build',
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}">`;
      return html.replace('</title>', `</title>\n    ${tag}`);
    }
  };
}

// Dev only: serve the standalone /how-to-use page for its directory URL.
// Vite's dev server doesn't resolve a public sub-directory's index.html for a
// bare "/how-to-use/" request (it falls through to the SPA). Production static
// hosts resolve the directory index natively, so this is needed in dev only.
function howToUseRoute() {
  return {
    name: 'how-to-use-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path === '/how-to-use' || path === '/how-to-use/') req.url = '/how-to-use/index.html';
        next();
      });
    }
  };
}

// Goal: one self-contained index.html that runs offline from disk (file://),
// with no network calls, no CDN, no fonts-from-web. Everything (JS, CSS, fonts)
// is inlined so the built file is the durable, "outlives-the-company" artifact.
export default defineConfig({
  plugins: [howToUseRoute(), svelte(), viteSingleFile(), injectCspOnBuild()],
  build: {
    target: 'es2020',
    // Inline every asset (incl. woff2 fonts) as base64 so nothing is fetched.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});
