// Item tags: bulk-tag selected items, see the chip in both edit and read
// mode, filter by tag, and reference an item tag from a guide so clicking it
// opens Items filtered to that tag. Mirrors files-tags.mjs.

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

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Item tags', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  items: [{ id: 'i1', name: 'Passport' }, { id: 'i2', name: 'House deed' }],
  guides: [{ id: 'g1', title: 'Overview', audience_person_ids: ['p1'], content: { en: 'Overview.' } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-itemtags-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (b) b.click(); }, t);
const goItems = () => page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Items'))?.click());
const openGuideRead = (t) => page.evaluate((t) => [...document.querySelectorAll('nav .navlink')].find((b) => b.textContent.trim() === t)?.click(), t);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  // --- bulk-tag both items from the Items list, in edit mode ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await goItems(); await pause();
  await page.evaluate(() => document.querySelectorAll('main .ulist .rowcheck').forEach((c) => c.click())); await pause();
  await page.type('.bulk-input', 'Tax 2009');
  await page.evaluate(() => [...document.querySelectorAll('.bulk-tag button')].find((b) => b.textContent.includes('Add tag'))?.click()); await pause(300);
  ok('bulk-tag slugifies and applies to selected items', await page.evaluate(() => document.querySelectorAll('main .ulist .row-tag').length === 2 && [...document.querySelectorAll('main .ulist .row-tag')].every((t) => t.textContent.includes('tax-2009'))));

  // --- the chip is visible in read mode too ---
  await page.evaluate(() => document.querySelector('.plan-done, .plan-edit')?.click()); await pause(400);
  await goItems(); await pause();
  ok('tag chip also shows in read mode', await page.evaluate(() => document.querySelectorAll('main .ulist .row-tag').length === 2));

  // --- adding a tag from the item's own detail drawer ---
  await page.evaluate(() => document.querySelector('main .ulist .ulist-row .ulist-click')?.click()); await pause(300);
  ok('opening an item shows its tags in the drawer', await page.evaluate(() => !!document.querySelector('[role="dialog"] .row-tag')));
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()); await pause(200);

  // --- filter by the tag (edit mode, open the Filter popover) ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await goItems(); await pause();
  await page.evaluate(() => document.querySelector('.filterbtn')?.click()); await pause(150);
  await page.evaluate(() => document.querySelector('.filterpop .facet .facet-opt input')?.click()); await pause(300);
  ok('tag filter shows the tagged items', await page.evaluate(() => document.querySelectorAll('main .ulist .ulist-row').length === 2 && document.querySelector('.filterbtn.on') != null && document.querySelector('.filterpills .fpill') != null));

  // --- reference the item tag from a guide, then click it in read mode ---
  await page.evaluate(() => [...document.querySelectorAll('nav .navguide-input')].find((i) => i.value === 'Overview')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit'), { timeout: 6000 });
  await pause();
  await page.click('main .ce .ce-edit');
  await page.keyboard.press('End');
  await page.keyboard.type(' Docs: ');
  await page.evaluate(() => [...document.querySelectorAll('.ce .tb-ref')].find((b) => /Mention/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.refpop .refq'), { timeout: 5000 });
  await page.type('.refpop .refq', 'tax'); await pause(300);
  await page.evaluate(() => { const r = [...document.querySelectorAll('.refpop .refrow')].find((x) => x.querySelector('.refname')?.textContent.trim() === '# tax-2009'); if (r) r.click(); }); await pause(300);
  ok('item tag inserts as an atomic chip', await page.evaluate(() => { const c = document.querySelector('main .ce .ce-edit .refchip.tagchip-inline'); return !!c && c.textContent.includes('tax-2009'); }));

  await page.evaluate(() => document.querySelector('.plan-done')?.click()); await pause(400);
  await openGuideRead('Overview');
  await page.waitForFunction(() => !!document.querySelector('main .prose'), { timeout: 6000 });
  await pause();
  ok('read mode renders an item-tag link', await page.evaluate(() => !!document.querySelector('main .prose a.taglink[data-tag-kind="item"]')));
  await page.evaluate(() => document.querySelector('main .prose a.taglink[data-tag-kind="item"]')?.click()); await pause(400);
  ok('clicking the item tag opens Items filtered to it', await page.evaluate(() => document.querySelector('main .vh')?.textContent.trim() === 'Items' && document.querySelector('.filterpills .fpill') != null && document.querySelectorAll('main .ulist .ulist-row').length === 2));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Item tags ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
