// Recover an editable plan from a heir reader (start-here.html): export the
// reader, then re-open it in a fresh builder and confirm the plan comes back
// editable. Also: a non-reader file fails gracefully.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(resolve(tmpdir(), 'lp-recover-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });

try {
  // Produce a heir reader from the Demo.
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Demo')?.click());
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.plan-edit'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /create reader/i.test(b.textContent))?.click());
  const out = resolve(dir, 'start-here.html');
  let waited = 0; while (!existsSync(out) && waited < 8000) { await pause(150); waited += 150; }
  ok('start-here.html produced', existsSync(out));

  // Recover: open the reader in a fresh builder via "Open existing plan".
  const p2 = await browser.newPage();
  const errs = []; p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(FILE, { waitUntil: 'load' });
  await p2.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  const input = await p2.$('input[type=file]:not([webkitdirectory])');
  await input.uploadFile(out);
  await p2.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  // Past the gate, into the plan.
  await p2.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await p2.waitForFunction(() => !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await pause();

  ok('recovered plan is editable (edit pencil present)', await p2.evaluate(() => !!document.querySelector('.plan-edit')));
  const counts = await p2.evaluate(() => {
    const m = {};
    for (const b of document.querySelectorAll('nav .navlink-section')) {
      const c = b.querySelector('.navcount');
      if (c) m[b.textContent.replace(/\d+$/, '').trim()] = Number(c.textContent);
    }
    return m;
  });
  ok('recovered people + items', counts.People === 9 && counts.Items === 43);
  ok('recovered JSON-only demo has no Files section', !('Files' in counts));
  ok('no runtime errors during recovery', errs.length === 0);

  // --- Password-protected reader: recover by unlocking ---
  const dir2 = mkdtempSync(resolve(tmpdir(), 'lp-recover2-'));
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir2, eventsEnabled: true });
  const PW = 'otter-freewill-coexist-snowdrift';
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  await page.evaluate(() => { const l = [...document.querySelectorAll('[role="dialog"] label')].find((x) => /Protect with a password/.test(x.textContent)); const cb = l?.querySelector('input[type=checkbox]'); if (cb && !cb.checked) cb.click(); });
  await pause(200);
  await page.type('[role="dialog"] input[type=password]', PW);
  // Hand-typed passwords must be repeated (typo guard) — fill the confirm field.
  await pause(200);
  await page.evaluate((pw) => {
    const inputs = [...document.querySelectorAll('[role="dialog"] input[type=password]')];
    if (inputs[1]) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(inputs[1], pw); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); }
  }, PW);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /create reader/i.test(b.textContent))?.click());
  const enc = resolve(dir2, 'start-here.html');
  let w2 = 0; while (!existsSync(enc) && w2 < 8000) { await pause(150); w2 += 150; }
  ok('encrypted start-here.html produced', existsSync(enc));

  const p4 = await browser.newPage();
  await p4.goto(FILE, { waitUntil: 'load' });
  await p4.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await p4.$('input[type=file]:not([webkitdirectory])')).uploadFile(enc);
  await p4.waitForFunction(() => !!document.querySelector('input.pw'), { timeout: 8000 });
  ok('encrypted reader prompts for a password', true);
  await p4.type('input.pw', PW);
  await p4.evaluate(() => [...document.querySelectorAll('button')].find((b) => /unlock/i.test(b.textContent))?.click());
  await p4.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await p4.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await p4.waitForFunction(() => !!document.querySelector('nav .navcount'), { timeout: 8000 });
  ok('encrypted reader recovers after unlock', await p4.evaluate(() => Number([...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.querySelector('.navcount')?.textContent) === 9));
  rmSync(dir2, { recursive: true, force: true });

  // A non-reader .html fails with a friendly message.
  const junk = resolve(dir, 'junk.html');
  writeFileSync(junk, '<!doctype html><html><body>not a plan</body></html>');
  const p3 = await browser.newPage();
  await p3.goto(FILE, { waitUntil: 'load' });
  await p3.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  const inp3 = await p3.$('input[type=file]:not([webkitdirectory])');
  await inp3.uploadFile(junk);
  await pause(600);
  ok('non-reader .html shows a friendly error', await p3.evaluate(() => /isn.t an OpenFirst reader/i.test(document.querySelector('.error')?.textContent || '')));
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Recover from reader (.html) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
