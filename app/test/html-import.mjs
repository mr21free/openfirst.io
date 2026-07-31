// Landing's single "Open existing plan" button (covers .html/.json/.zip) —
// the missing half of CHANGES.md's "two ways in: the plan .html itself, and a
// plain .json package." Before this, a container-v1 .html could only be
// reopened via double-click (always read-only) or the recent-plans "Locate
// it" row (which requires the plan already be known to this browser and
// rejects any other planId). This lets someone open a plan .html this
// browser has never seen — a new device, or a file someone else sent them —
// and reconnects it live via File System Access, same as reconnecting a
// recent plan.
//
// Headless Chrome has no real, automatable showOpenFilePicker dialog, so this
// fakes the picker itself (a plain global function override) to hand back a
// synthetic FileSystemFileHandle-shaped object wrapping real container-v1
// HTML produced by an earlier, genuine save — exercising the exact same
// App.svelte code path a real picked file would.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const FILE = 'file://' + resolve('.', 'dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

const addPerson = async (page, name) => {
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', name);
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 6000 }, name);
};

// Builds a real container-v1 .html via the fallback download path (headless
// Chrome has no showSaveFilePicker) and returns its text content. Each call
// gets its own download dir — same suggested filename each time, and Chrome's
// CDP-driven downloads overwrite rather than auto-rename on a collision.
async function buildRealPlanHtml(browser, parentDir, { protect } = {}) {
  const dir = mkdtempSync(resolve(parentDir, 'build-'));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
  await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });

  if (protect) {
    await page.evaluate(() => [...document.querySelectorAll('button.abtn')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
    await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Add') && b.textContent.includes('passphrase'))?.click());
    await pause(200);
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('[role="dialog"] input')].find((i) => i.placeholder?.toLowerCase().includes('label'));
      if (label) { label.value = 'For testing'; label.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await page.type('[role="dialog"] input[type="password"]', 'correct horse battery staple');
    // A hand-typed (non-generated) passphrase makes PassphraseField grow a
    // second "repeat it" input, a sibling of a different parent — not simply
    // the same element "last" under a shared :last-of-type scope — so it must
    // be typed into by index, not by re-querying the same compound selector.
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] input[type="password"]').length === 2, { timeout: 4000 });
    const confirmHandle = (await page.$$('[role="dialog"] input[type="password"]'))[1];
    await confirmHandle.type('correct horse battery staple');
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Add')?.click());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] .slot-label-input'), { timeout: 6000 });
    await page.keyboard.press('Escape');
  }

  await addPerson(page, 'ZZ Import Source Person');
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  await page.evaluate(() => document.querySelector('.filestatus.warn button')?.click());

  const findOut = () => readdirSync(dir).find((f) => f.endsWith('.html'));
  let waited = 0;
  while (!findOut() && waited < 8000) { await pause(); waited += 150; }
  const found = findOut();
  const html = found ? readFileSync(resolve(dir, found), 'utf8') : null;
  await page.close();
  return { html, fileName: found };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const dir = mkdtempSync(resolve(tmpdir(), 'lp-html-import-'));

try {
  const { html: plainHtml, fileName: plainName } = await buildRealPlanHtml(browser, dir);
  ok('produced a real, unprotected container-v1 .html to import', !!plainHtml);

  const { html: protectedHtml, fileName: protectedName } = await buildRealPlanHtml(browser, dir, { protect: true });
  ok('produced a real, passphrase-protected container-v1 .html to import', !!protectedHtml);

  // Each check below runs in its own fresh incognito-style context, so no
  // draft/recent-plans state carries over — genuinely "never seen before".
  const freshPage = async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    return { ctx, page };
  };
  const fakePicker = (page, html, name) => page.evaluate((html, name) => {
    window.showOpenFilePicker = async () => [{
      name,
      getFile: async () => new File([html], name, { type: 'text/html' }),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted'
    }];
  }, html, name);

  // 1) Unprotected plan, opened cold.
  {
    const { ctx, page } = await freshPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    ok('"Open existing plan" button is offered on the launcher', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Open existing plan')));
    await fakePicker(page, plainHtml, plainName);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open existing plan')?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
    await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
    await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
    ok('a never-seen .html loads with its real content', await page.evaluate(() => document.body.innerText.includes('ZZ Import Source Person')));
    ok('it reconnects as a real file, not a fresh unsaved draft (no "Browser only" warning)', await page.evaluate(() => !document.querySelector('.filestatus.warn')?.textContent.includes('Browser only')));
    // A further edit must not throw even though the "file" is a fake handle
    // with a working createWritable stub — proves the live-write path is wired.
    await addPerson(page, 'ZZ After Reconnect');
    await pause(1000);
    ok('editing after reconnect causes no runtime errors', errs.length === 0);
    await ctx.close();
  }

  // 1b) Regression: opening any plan resets the in-memory recent-plans list
  // to [] (see openPickedFileHandle), and used to stay empty until a hard
  // reload — App.svelte's close() didn't refresh the launcher lists on the
  // way out. Seed an unrelated already-known recent plan directly in
  // IndexedDB (real, cloneable record — the fake picker's handle below can't
  // survive a structured-clone round-trip, see the seeded-lock regression
  // further down), open a second, different plan via the fake picker, then
  // go "Back to start": the pre-existing recent plan must reappear without a
  // reload, proving close() re-populates the list rather than leaving it
  // emptied out.
  {
    const { ctx, page } = await freshPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('lifepackage');
      req.onsuccess = () => {
        const tx = req.result.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(
          { name: 'Preexisting Plan.html', handle: null, fileRevision: 0, protected: false, lastOpenedAt: Date.now() },
          'plan_preexisting_close_test'
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    ok('the seeded recent plan shows up on initial boot', await page.evaluate(() => [...document.querySelectorAll('.draft-main strong')].some((el) => el.textContent.includes('Preexisting Plan.html'))));
    await fakePicker(page, plainHtml, plainName);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open existing plan')?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
    await page.evaluate(() => document.querySelector('[aria-label="Back to start"]')?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    ok('the pre-existing recent plan reappears after "Back to start" without a reload', await page.evaluate(() => [...document.querySelectorAll('.draft-main strong')].some((el) => el.textContent.includes('Preexisting Plan.html'))));
    ok('no runtime errors on the reconnect-then-close path', errs.length === 0);
    await ctx.close();
  }

  // 2) Garbage content — must surface a readable error, not crash.
  {
    const { ctx, page } = await freshPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    await fakePicker(page, '<html><body>not a plan file</body></html>', 'junk.html');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open existing plan')?.click());
    await page.waitForFunction(() => document.body.innerText.includes("Couldn't open that file"), { timeout: 6000 });
    ok('a non-plan .html shows a readable error instead of crashing', true);
    ok('no runtime errors on the garbage-file path', errs.length === 0);
    await ctx.close();
  }

  // 3) Passphrase-protected plan — must gate behind UnlockGate, not load straight in.
  {
    const { ctx, page } = await freshPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    await fakePicker(page, protectedHtml, protectedName);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open existing plan')?.click());
    await page.waitForFunction(() => !!document.querySelector('.gate .pw.inp'), { timeout: 6000 });
    ok('a protected never-seen .html is gated behind the passphrase prompt', true);
    await page.type('.gate .pw.inp', 'correct horse battery staple');
    await page.evaluate(() => [...document.querySelectorAll('.gate button')].find((b) => /unlock/i.test(b.textContent))?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 6000 });
    await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
    await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
    ok('the right passphrase unlocks it and loads the real content', await page.evaluate(() => document.body.innerText.includes('ZZ Import Source Person')));
    ok('no runtime errors on the protected-file path', errs.length === 0);
    await ctx.close();
  }

  // Regression: a plan reconnected as file-backed for the very first time has
  // no local scratch draft yet (that's only ever written by a real edit — see
  // store.svelte.js's #processChanges), so the launcher's lock icon can't be
  // derived from it the way it is for plans this browser has actually edited
  // before. persist.js's putFileHandle now carries its own `protected` flag,
  // written immediately on every open/reconnect, for exactly this case (see
  // App.svelte's refreshDrafts). Seeded directly into IndexedDB here — the
  // fake picker's handle (above) has function properties and can't survive a
  // real structured-clone round-trip the way a genuine FileSystemFileHandle
  // can, so it can't be used to exercise the persisted-then-reloaded path.
  {
    const { ctx, page } = await freshPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('lifepackage');
      req.onsuccess = () => {
        const tx = req.result.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(
          { name: 'Seeded Plan.html', handle: null, fileRevision: 0, protected: true, lastOpenedAt: Date.now() },
          'plan_seeded_lock_test'
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
    ok('a never-before-edited protected recent plan already shows the lock icon on the launcher', await page.evaluate(() => !!document.querySelector('.draft-lock[title="Passphrase-protected"]')));
    ok('no runtime errors on the seeded-handle path', errs.length === 0);
    await ctx.close();
  }
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Open existing plan (.html import, unfamiliar to this browser) ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
