// Per-language guide titles and group names. Editing a name in one language
// stores an override for that language only; other languages fall back to the
// default-language (primary) value until translated.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || /ownership_invalid/.test(m.text())) errors.push(m.text().split('\n')[0]); });

const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (b) b.click(); }, t);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const guideTitle = () => page.evaluate(() => document.querySelector('nav .navrow input')?.value);
const groupName = () => page.evaluate(() => document.querySelector('nav .navgroup-input')?.value);
async function setInput(sel, val) { const h = await page.$(sel); await h.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.type(val); await pause(150); }

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await click('Create new plan'); await pause();

  // Add a second language via Settings.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .row-add input'), { timeout: 4000 });
  await page.type('[role="dialog"] .row-add input', 'sk');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .row-add button')].find((b) => b.textContent.trim() === '+')?.click());
  await pause(); await page.keyboard.press('Escape'); await pause();
  ok('language selector appears with a 2nd language', await page.evaluate(() => !!document.querySelector('select.sel.lang')));

  // Default-language (EN) names.
  await setInput('nav .navrow input', 'Start EN');
  await setInput('nav .navgroup-input', 'Group EN');
  ok('default-language names set', (await guideTitle()) === 'Start EN' && (await groupName()) === 'Group EN');

  // Switching language shows the default value until translated.
  await page.select('select.sel.lang', 'sk'); await pause(250);
  ok('untranslated language falls back to default', (await guideTitle()) === 'Start EN' && (await groupName()) === 'Group EN');

  // Translate in SK.
  await setInput('nav .navrow input', 'Start SK');
  await setInput('nav .navgroup-input', 'Group SK');
  ok('SK overrides set independently', (await guideTitle()) === 'Start SK' && (await groupName()) === 'Group SK');

  // Back to EN — originals preserved.
  await page.select('select.sel.lang', 'en'); await pause(250);
  ok('EN names unchanged after editing SK', (await guideTitle()) === 'Start EN' && (await groupName()) === 'Group EN');

  // SK again — overrides preserved.
  await page.select('select.sel.lang', 'sk'); await pause(250);
  ok('SK overrides persist', (await guideTitle()) === 'Start SK' && (await groupName()) === 'Group SK');

  ok('no runtime / ownership errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Guide title / group name i18n ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
