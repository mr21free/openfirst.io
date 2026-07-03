import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Strict CSP for the PRODUCTION single file only. Everything is inlined there,
// so 'unsafe-inline' covers our own bundle while connect-src 'none' guarantees a
// tampered package can never exfiltrate anything. Not applied in dev (Vite needs
// the network for its client + HMR).
const PROD_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "font-src data:; img-src 'self' data: blob:; media-src data: blob:; frame-src data: blob:; connect-src 'none'; " +
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

const MARKETING_HOME = fileURLToPath(new URL('./site/index.html', import.meta.url));
const APP_ROUTES = ['build', 'open', 'demo'];
const STATIC_PAGES = ['how-to-use', 'security', 'pricing'];

function matchesDir(path, dir) {
  return path === `/${dir}` || path === `/${dir}/` || path === `/${dir}/index.html`;
}

// Dev only: make `npm run dev` mirror the public information architecture.
// The final build is split by scripts/postbuild.mjs, but during dev we keep the
// Vite app shell at /build/, /open/ and /demo/, and serve the static marketing
// home at /. This lets the whole site be clicked through locally without a
// rebuild after every app change.
function localSiteRoutes() {
  return {
    name: 'local-site-routes',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(MARKETING_HOME);
      server.watcher.on('change', (file) => {
        if (file === MARKETING_HOME) server.ws.send({ type: 'full-reload', path: '/' });
      });

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path === '/' || path === '/index.html') {
          try {
            const html = readFileSync(MARKETING_HOME, 'utf8');
            const transformed = await server.transformIndexHtml('/', html);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(transformed);
          } catch (err) {
            next(err);
          }
          return;
        }

        for (const route of APP_ROUTES) {
          if (matchesDir(path, route)) {
            req.url = '/index.html';
            next();
            return;
          }
        }

        // Vite's dev server doesn't resolve a public sub-directory's index.html
        // for a bare "/how-to-use/" request (it falls through to the SPA).
        for (const page of STATIC_PAGES) {
          if (matchesDir(path, page)) {
            req.url = `/${page}/index.html`;
            next();
            return;
          }
        }

        next();
      });
    }
  };
}

// Goal: one self-contained index.html that runs offline from disk (file://),
// with no network calls, no CDN, no fonts-from-web. Everything (JS, CSS, fonts)
// is inlined so the built file is the durable, "outlives-the-company" artifact.
export default defineConfig({
  plugins: [localSiteRoutes(), svelte(), viteSingleFile(), injectCspOnBuild()],
  build: {
    target: 'es2020',
    // Inline every asset (incl. woff2 fonts) as base64 so nothing is fetched.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});
