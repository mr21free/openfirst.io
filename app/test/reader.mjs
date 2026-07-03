import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const sample = JSON.parse(readFileSync(resolve(__dirname, '../src/sample/lifepackage.json'), 'utf8'));
const payload = { reader: true, v: 1, data: sample, attachments: {} };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

try {
  // Simulate the self-contained reader: the embedded plan is set before app boot.
  await page.evaluateOnNewDocument((p) => { window.__LIFE_PACKAGE__ = p; }, payload);
  await page.goto(FILE, { waitUntil: 'load' });

  // Embedded reader boots straight into the plan (who-are-you gate), no Landing.
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  ok('embedded reader boots into the plan (no landing)', true);
  ok('no "Create a new plan" (builder) action', !(await page.evaluate(() => document.body.innerText.includes('Create a new plan'))));
  // The theme toggle must be reachable even on the "who are you?" gate.
  ok('theme toggle exposed on the gate', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Toggle dark mode')));

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('main'), { timeout: 8000 });

  ok('read-only: no edit (pencil) control', !(await page.evaluate(() => !!document.querySelector('.plan-edit'))));
  ok('read-only: no Export control', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Export'))));
  ok('read-only: no Settings control', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Settings'))));
  ok('theme toggle present', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Toggle dark mode')));
  ok('print control present', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Print')));

  // Theme toggle flips data-theme on <html>.
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Toggle dark mode')?.click());
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok('theme toggle changes appearance', before !== after && (after === 'dark' || after === 'light'));

  ok('no runtime errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Reader (self-contained heir build) ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
