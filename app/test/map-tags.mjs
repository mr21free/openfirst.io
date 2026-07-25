// Map tag filter: hidden until an item has a tag, then narrows the location
// tree down to matching items plus all their ancestor locations, "Clear all"
// resets it, and a [[view:map:slug]] guide reference deep-links into it.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// loc_a (root) -> loc_b -> loc_c holds the item we'll tag; loc_d is a sibling
// branch off loc_a holding an item that must disappear once filtered.
const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Map tags', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  locations: [
    { id: 'loc_a', name: 'Country' },
    { id: 'loc_b', name: 'City', parent_id: 'loc_a' },
    { id: 'loc_c', name: 'Home', parent_id: 'loc_b' },
    { id: 'loc_d', name: 'Office', parent_id: 'loc_a' }
  ],
  items: [
    { id: 'i1', name: 'Passport', location_ids: ['loc_c'] },
    { id: 'i2', name: 'Contract', location_ids: ['loc_d'] }
  ],
  guides: [{ id: 'g1', title: 'Overview', audience_person_ids: ['p1'], content: { en: 'Overview.' } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-maptags-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

const goMap = () => page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.trim() === 'Map')?.click());
const goItems = () => page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Items'))?.click());
const locNames = () => page.evaluate(() => [...document.querySelectorAll('main .map .loc-name')].map((n) => n.textContent.trim()));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  // --- no tags yet: the filter control is not shown ---
  await goMap(); await pause();
  ok('map filter hidden with no tagged items', await page.evaluate(() => !document.querySelector('main .map .filterbtn')));
  ok('both branches render untagged', (await locNames()).includes('Office') && (await locNames()).includes('Home'));

  // --- tag i1 (Passport) with "travel" from its edit-mode drawer ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await goItems(); await pause();
  await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-click')].find((b) => b.textContent.includes('Passport'))?.click()); await pause(300);
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .tag-add .inp'), { timeout: 5000 });
  await page.type('[role="dialog"] .tag-add .inp', 'Travel');
  await page.keyboard.press('Enter'); await pause(200);
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()); await pause(300);
  await page.evaluate(() => document.querySelector('.plan-done')?.click()); await pause(400);

  // --- the filter now appears and, once applied, narrows to the matching branch ---
  await goMap(); await pause();
  ok('map filter appears once an item has a tag', await page.evaluate(() => !!document.querySelector('main .map .filterbtn')));
  await page.evaluate(() => document.querySelector('main .map .filterbtn')?.click()); await pause(150);
  await page.evaluate(() => document.querySelector('main .map .filterpop .facet .facet-opt input')?.click()); await pause(300);
  const filtered = await locNames();
  ok('filtering keeps the matching item\'s branch (root + ancestors)', filtered.includes('Country') && filtered.includes('City') && filtered.includes('Home'));
  ok('filtering hides the non-matching branch', !filtered.includes('Office'));
  ok('the applied tag is shown with a pill', await page.evaluate(() => !!document.querySelector('main .map .filterpills .fpill') && document.querySelector('main .map .filterpills').textContent.includes('travel')));

  // --- Clear all resets it ---
  await page.evaluate(() => [...document.querySelectorAll('main .map .pill-clear')].find((b) => /clear all/i.test(b.textContent))?.click()); await pause(300);
  const cleared = await locNames();
  ok('"Clear all" restores the full tree', cleared.includes('Office') && cleared.includes('Home'));

  // --- guide deep link: [[view:map:travel]] opens Map pre-filtered ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('nav .navguide-input')].find((i) => i.value === 'Overview')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit'), { timeout: 6000 });
  await pause();
  await page.click('main .ce .ce-edit');
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await page.evaluate(() => [...document.querySelectorAll('.ce .tb-ref')].find((b) => /Mention/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.refpop .refq'), { timeout: 5000 });
  await page.type('.refpop .refq', 'travel'); await pause(300);
  ok('the reference picker offers a tag-scoped Map link', await page.evaluate(() => [...document.querySelectorAll('.refpop .refrow .refname')].some((n) => /Map.*travel/i.test(n.textContent))));
  await page.evaluate(() => { const r = [...document.querySelectorAll('.refpop .refrow')].find((x) => /Map.*travel/i.test(x.querySelector('.refname')?.textContent || '')); if (r) r.click(); }); await pause(300);
  ok('picking it inserts a tag-scoped Map view chip', await page.evaluate(() => { const c = document.querySelector('.ce-edit .refchip.viewchip-inline'); return !!c && c.dataset.refId === 'view:map:travel'; }));

  await page.evaluate(() => document.querySelector('.plan-done')?.click()); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink')].find((b) => b.textContent.trim() === 'Overview')?.click());
  await page.waitForFunction(() => !!document.querySelector('main .prose'), { timeout: 6000 });
  await pause();
  await page.evaluate(() => document.querySelector('main .prose a.viewlink')?.click()); await pause(400);
  ok('clicking the tag-scoped Map link opens the Map pre-filtered', await page.evaluate(() =>
    document.querySelector('main .vh')?.textContent.trim() === 'Map' &&
    !!document.querySelector('main .map .filterpills .fpill') &&
    document.querySelector('main .map .filterpills').textContent.includes('travel')));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Map tag filter ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
