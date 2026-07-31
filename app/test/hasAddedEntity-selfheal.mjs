// Regression test for a residual-corruption bug: a draft saved while the (now
// fixed) debounce-race data-loss bug was still active could get permanently
// stuck with `hasAddedEntity: false` in IndexedDB (persistOnOpen()'s pre-edit
// baseline snapshot, since the real edit's save never landed) even though the
// plan clearly has real content. That flag alone gates the entire
// FileSaveBanner bottom bar (see Reader.svelte/FileSaveBanner.svelte), so a
// plan in that state looks like it has no save/download button anywhere.
//
// The fix (store.svelte.js's `hasRealContent`, applied at every "resume a
// persisted draft" call site in App.svelte) derives "has real content"
// straight from the plan data as a fallback OR'd with the stored flag, so a
// corrupted record self-heals the next time it's resumed — no user action,
// no migration script.
//
// This test creates a plan normally, adds a person, then reaches directly
// into IndexedDB to simulate exactly the corruption described above (flips
// the already-saved record's hasAddedEntity back to false, mimicking what the
// old bug would have left behind), and confirms a plain reload still shows
// the file-status bar despite the stale flag.
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
const NAME = 'ZZ Selfheal Person';

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

  // Let the debounced autosave actually land before we go poke at it directly.
  await page.waitForFunction(() => !!document.querySelector('.filestatus'), { timeout: 6000 });

  // Sanity check first: the bar is up and hasAddedEntity is genuinely true
  // right now, from the real add-person flow (not from the fix under test).
  const trueFirst = await page.evaluate(() => !!document.querySelector('.filestatus'));
  ok('the bar is shown right after adding a person', trueFirst);

  // Reach into IndexedDB and corrupt the just-saved record exactly the way
  // the old debounce-race bug would have left it: real content, but
  // hasAddedEntity/revision stuck at their pre-edit baseline values.
  const planKey = await page.evaluate(() => sessionStorage.getItem('openfirst.currentPlan'));
  const corrupted = await page.evaluate((key) => new Promise((resolveP, rejectP) => {
    const req = indexedDB.open('lifepackage', 3);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { rejectP(new Error('no draft record found for key ' + key)); return; }
        record.hasAddedEntity = false;
        record.revision = 0;
        store.put(record, key);
      };
      tx.oncomplete = () => resolveP(true);
      tx.onerror = () => rejectP(tx.error);
    };
    req.onerror = () => rejectP(req.error);
  }), planKey);
  ok('simulated the old corruption directly in IndexedDB', corrupted === true);

  // A plain reload re-triggers /build/'s sessionStorage auto-resume
  // (resumeDraft), which is where the self-healing hasRealContent fallback
  // lives (see App.svelte / store.svelte.js).
  await page.reload({ waitUntil: 'load' });

  const barSurvived = await page.waitForFunction(() => !!document.querySelector('.filestatus'), { timeout: 6000 })
    .then(() => true).catch(() => false);
  ok('the file-status bar still shows despite a corrupted hasAddedEntity:false record', barSurvived);

  await page.waitForFunction(() => [...document.querySelectorAll('.navlink-section')].length > 0, { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  const personSurvived = await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 6000 }, NAME)
    .then(() => true).catch(() => false);
  ok('the person data itself is untouched by the corruption/self-heal', personSurvived);

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); server.close(); }

console.log('\n=== hasAddedEntity self-heal on resume (residual debounce-race corruption) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
