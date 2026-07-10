import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const clickText = (page, t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(t)); if (b) { b.click(); return true; } return false; }, t);

const dir = mkdtempSync(resolve(tmpdir(), 'lp-reader-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });

try {
  // Builder: load the sample, reach the reader.
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await (await page.$('input[type="file"]')).uploadFile(resolve(__dirname, '../src/sample/lifepackage.json'));
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await clickText(page, 'Admin');
  await page.waitForFunction(() => !!document.querySelector('.plan-edit'), { timeout: 8000 });

  // Export → self-contained reader (default on), no password → Create reader.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  const readerOn = await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('[role="dialog"] label')].find((l) => /self-contained reader/i.test(l.textContent));
    return !!lbl?.querySelector('input[type=checkbox]')?.checked;
  });
  ok('export dialog defaults to self-contained reader', readerOn);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /create reader/i.test(b.textContent))?.click());

  // Wait for start-here.html to land.
  const out = resolve(dir, 'start-here.html');
  let waited = 0;
  while (!existsSync(out) && waited < 8000) { await new Promise((r) => setTimeout(r, 150)); waited += 150; }
  ok('start-here.html was produced', existsSync(out));

  // Open the produced file: it must boot read-only into the plan.
  const p2 = await browser.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto('file://' + out, { waitUntil: 'load' });
  await p2.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  ok('produced reader boots into the plan', true);
  await p2.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await p2.waitForFunction(() => !!document.querySelector('main'), { timeout: 8000 });
  ok('produced reader is read-only (no edit pencil)', !(await p2.evaluate(() => !!document.querySelector('.plan-edit'))));
  ok('produced reader has the theme toggle', await p2.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Toggle dark mode')));
  ok('produced reader has no script pageerrors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Self-contained export loop ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
