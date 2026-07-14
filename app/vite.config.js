import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, build as viteBuild } from 'vite';
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
const NOT_FOUND = fileURLToPath(new URL('./public/404.html', import.meta.url));
const APP_ROUTES = ['build', 'open', 'demo'];
const STATIC_PAGES = ['how-to-use', 'security', 'pricing', 'guides'];

// A request for a page (not an asset or a Vite internal) that matched no route.
// On a static host an unknown path serves 404.html; mirror that locally so the
// app's SPA fallback never masks a real 404 (e.g. /whatever showing the launcher).
function isUnknownPageRequest(path, accept) {
  if (!(accept || '').includes('text/html')) return false;
  if (path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules') || path.startsWith('/.')) return false;
  const last = path.split('/').pop();
  return !last.includes('.'); // no file extension → a page path, not an asset
}

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
        // /guides/ has nested pages, so any depth under a static page works.
        for (const page of STATIC_PAGES) {
          if (matchesDir(path, page)) {
            req.url = `/${page}/index.html`;
            next();
            return;
          }
          if (path.startsWith(`/${page}/`) && path.endsWith('/')) {
            req.url = `${path}index.html`;
            next();
            return;
          }
        }

        if (isUnknownPageRequest(path, req.headers.accept)) {
          try {
            const html = readFileSync(NOT_FOUND, 'utf8');
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(await server.transformIndexHtml(path, html));
            return;
          } catch { /* fall through */ }
        }

        next();
      });
    },
    // `npm run preview` serves the built dist/. Mirror the host's behaviour:
    // an unknown page path that has no matching file returns dist/404.html.
    configurePreviewServer(server) {
      const dist = fileURLToPath(new URL('./dist', import.meta.url));
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (isUnknownPageRequest(path, req.headers.accept)) {
          const asFile = resolve(dist, '.' + path);
          const asIndex = resolve(dist, '.' + path.replace(/\/?$/, '/') + 'index.html');
          if (!existsSync(asFile) && !existsSync(asIndex)) {
            try {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(readFileSync(resolve(dist, '404.html'), 'utf8'));
              return;
            } catch { /* fall through */ }
          }
        }
        next();
      });
    }
  };
}

// The self-contained heir export (start-here.html) needs a fully inlined page
// to clone — the dev server serves the app over the network (/@vite/client,
// /src/main.js), which can't stand alone as a file. Rather than send the owner
// off to run `npm run build` by hand, run a real (in-memory) production build
// on demand and serve it at this URL; export.js fetches it when it detects
// dev mode. Cached until a source file changes, so repeat exports are instant.
function readerTemplateDevServer() {
  const ROUTE = '/__reader-template.html';
  let cache = null;
  let building = null;
  return {
    name: 'reader-template-dev-server',
    apply: 'serve',
    configureServer(server) {
      const invalidate = (file) => {
        if (file.includes('/dist/') || file.includes('/node_modules/')) return;
        cache = null;
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('change', invalidate);
      server.watcher.on('unlink', invalidate);

      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== ROUTE) return next();
        try {
          if (!cache) {
            building ??= viteBuild({
              configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)),
              logLevel: 'silent',
              build: { write: false }
            }).finally(() => { building = null; });
            const result = await building;
            const bundle = Array.isArray(result) ? result[0] : result;
            const chunk = bundle.output.find((o) => o.fileName === 'index.html');
            cache = chunk?.source;
          }
          if (!cache) throw new Error('production build produced no index.html');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(cache);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`Reader template build failed: ${err?.message || err}`);
        }
      });
    }
  };
}

// Goal: one self-contained index.html that runs offline from disk (file://),
// with no network calls, no CDN, no fonts-from-web. Everything (JS, CSS, fonts)
// is inlined so the built file is the durable, "outlives-the-company" artifact.
export default defineConfig({
  plugins: [localSiteRoutes(), svelte(), viteSingleFile(), injectCspOnBuild(), readerTemplateDevServer()],
  build: {
    target: 'es2020',
    // Inline every asset (incl. woff2 fonts) as base64 so nothing is fetched.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});
