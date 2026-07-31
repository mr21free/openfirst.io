// Regression test for a debounce-race data-loss bug: refreshing the browser
// shortly after an edit could lose that edit entirely, because the autosave
// write is debounced behind the last edit (see store.svelte.js's
// #scheduleProcess) and a visibilitychange-triggered flush isn't reliably
// given time to finish before the page is torn down on a fast reload. The
// fix shrinks the debounce to 50ms so the write reliably finishes on its own
// well before any realistic reload — this test reloads as fast as a script
// can manage right after adding a person, with no artificial delay.
//
// Served over real http (not file://): the app only auto-resumes into
// /build/ on http(s) (see App.svelte's bootMode) — file:// always lands back
// on the launcher on reload, which doesn't exercise the same fast-refresh
// path a real deployment (openfirst.io) faces.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const NAME = 'ZZ Debounce Race Person';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  const full = resolve(DIST, '.' + path);
  if (!full.startsWith(DIST) || !existsSync(full)) { res.writeHead(404); res.end(); return; }
  const ext = full.slice(full.lastIndexOf('.'));
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(await readFile(full));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const errs = [];

let page;
try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${ORIGIN}/build/`, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());

  await page.waitForFunction(() => !!document.querySelector('.navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.head-actions button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('.head-actions button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });

  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', NAME);
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 6000 }, NAME);

  // No pause here at all — refresh as fast as the script can manage, right
  // on the heels of the edit. This is deliberately the worst case, not a
  // realistic "gave it a moment" scenario.
  await page.reload({ waitUntil: 'load' });

  await page.waitForFunction(() => [...document.querySelectorAll('.navlink-section')].length > 0, { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  const survived = await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 6000 }, NAME)
    .then(() => true).catch(() => false);
  ok('the person added right before a fast refresh survives it', survived);

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); server.close(); }

console.log('\n=== Debounce-race fast-refresh data loss ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
