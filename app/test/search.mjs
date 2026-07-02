// Global search in the top bar: a top-10 dropdown ranked guides + things in the
// guides first, then high-importance; ENTER with nothing picked opens a results
// view (not a nav section); picking a result navigates (guide) or opens it (entity).
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Search test', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }, { id: 'p_tz', name: 'Trezor Expert' }],
  items: [
    { id: 'i_ref', name: 'Referenced trezor item' },          // in a guide
    { id: 'i_high', name: 'High trezor item', importance: 'high' },
    { id: 'i_plain', name: 'Plain trezor item' }
  ],
  guides: [{ id: 'g1', title: 'Trezor guide', audience_person_ids: ['p1'], content: { en: 'Use the [[i_ref]].' }, references: { item_ids: ['i_ref'] } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-search-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

const dropdownNames = () => page.evaluate(() => [...document.querySelectorAll('.gs-pop .gs-row .gs-name')].map((n) => n.textContent.trim()));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.gs-input'), { timeout: 8000 });

  // --- Dropdown + ranking ---
  await page.type('.gs-input', 'trezor');
  await page.waitForFunction(() => document.querySelectorAll('.gs-pop .gs-row .gs-name').length >= 4, { timeout: 5000 });
  const names = await dropdownNames();
  ok('search shows a top-results dropdown', names.length >= 4);
  ok('a matching guide ranks first', names[0] === 'Trezor guide');
  ok('a thing in the guides outranks a high-importance one not in a guide',
    names.indexOf('Referenced trezor item') >= 0 && names.indexOf('Referenced trezor item') < names.indexOf('High trezor item'));
  ok('search is not exposed as a nav section', await page.evaluate(() =>
    ![...document.querySelectorAll('nav .navlink-section')].some((b) => /^Search/.test(b.textContent.trim()))));

  // --- ENTER with nothing picked → results view ---
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Search', { timeout: 5000 });
  const pageRows = await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-name')].map((n) => n.textContent.trim()));
  ok('ENTER opens a search results view', pageRows.length >= 4 && pageRows[0] === 'Trezor guide');

  // --- Clicking a guide result navigates to that guide ---
  await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-click')].find((b) => /Trezor guide/.test(b.textContent))?.click());
  await page.waitForFunction(() => document.querySelector('main h2')?.textContent.trim() === 'Trezor guide', { timeout: 5000 });
  ok('clicking a guide result opens the guide', true);

  // --- Arrow-down + Enter picks an entity result (opens its drawer) ---
  await page.click('.gs-input', { clickCount: 3 });
  await page.type('.gs-input', 'High trezor');
  await page.waitForFunction(() => document.querySelectorAll('.gs-pop .gs-row').length >= 1, { timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  ok('arrow-down + Enter picks an entity (opens its drawer)', await page.waitForFunction(() =>
    /High trezor item/.test(document.querySelector('.drawer h2')?.textContent || ''), { timeout: 5000 }).then(() => true).catch(() => false));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Global search ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
