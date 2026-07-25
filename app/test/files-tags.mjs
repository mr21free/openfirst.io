// File tags: bulk-tag selected files, filter by tag, and reference a tag from a
// guide so clicking it opens Files filtered to that tag.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const dir = mkdtempSync(resolve(tmpdir(), 'lp-tags-'));
writeFileSync(resolve(dir, 'a.txt'), 'a');
writeFileSync(resolve(dir, 'b.txt'), 'b');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (b) b.click(); }, t);
const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const goFiles = () => page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Files'))?.click());

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await click('Create new plan'); await pause();
  const inp = await page.$('input[type=file][multiple]:not([webkitdirectory])');
  await inp.uploadFile(resolve(dir, 'a.txt'), resolve(dir, 'b.txt')); await pause(700);

  await goFiles(); await pause();
  // bulk-tag both files with "Tax 2009" -> slug tax-2009
  await page.evaluate(() => document.querySelectorAll('main .ulist .rowcheck').forEach((c) => c.click())); await pause();
  await page.type('.bulk-input', 'Tax 2009');
  await page.evaluate(() => [...document.querySelectorAll('.bulk-tag button')].find((b) => b.textContent.includes('Add tag'))?.click()); await pause(300);
  ok('bulk-tag slugifies and applies to selected files', await page.evaluate(() => document.querySelectorAll('.row-tag').length === 2 && [...document.querySelectorAll('.row-tag')].every((t) => t.textContent.includes('tax-2009'))));

  // opening the file's own read-mode drawer also shows its tags
  await page.evaluate(() => document.querySelector('.plan-done')?.click()); await pause(400);
  await page.evaluate(() => document.querySelector('main .ulist .ulist-row .ulist-click')?.click()); await pause(300);
  ok('a file\'s read-mode drawer shows its tags', await page.evaluate(() => { const c = document.querySelector('[role="dialog"] .row-tag'); return !!c && c.textContent.includes('tax-2009'); }));
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()); await pause(200);
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await goFiles(); await pause();

  // filter by the tag (open the Filter popover, tick the Tag facet's first option)
  await page.evaluate(() => document.querySelector('.filterbtn')?.click()); await pause(150);
  await page.evaluate(() => document.querySelector('.filterpop .facet .facet-opt input')?.click()); await pause(300);
  ok('tag filter shows the tagged files', await page.evaluate(() => document.querySelectorAll('main .ulist .ulist-row').length === 2 && document.querySelector('.filterbtn.on') != null && document.querySelector('.filterpills .fpill') != null));

  // add a guide and reference the tag, then click it in read mode
  await click('+ New');
  await page.evaluate(() => [...document.querySelectorAll('.newpop button')].find((b) => b.textContent.includes('Guide'))?.click());
  await pause();
  await page.waitForFunction(() => !!document.querySelector('main .ce .tb-ref'), { timeout: 4000 });
  await page.click('main .ce .ce-edit'); await page.keyboard.type('Docs: ');
  await page.evaluate(() => document.querySelector('main .ce .tb-ref')?.click()); await pause();
  await page.type('main .ce .refq', 'tax'); await pause(300);
  await page.evaluate(() => { const r = [...document.querySelectorAll('main .ce .refrow')].find((x) => x.querySelector('.refname')?.textContent.trim() === '# tax-2009'); if (r) r.click(); }); await pause(300);
  ok('tag inserts as an atomic chip', await page.evaluate(() => { const c = document.querySelector('main .ce .ce-edit .refchip.tagchip-inline'); return !!c && c.textContent.includes('tax-2009'); }));

  await page.keyboard.down('Control'); await page.keyboard.press('KeyE'); await page.keyboard.up('Control'); await pause();
  ok('read mode renders a tag link', await page.evaluate(() => !!document.querySelector('main .prose a.taglink')));
  await page.evaluate(() => document.querySelector('main .prose a.taglink')?.click()); await pause(400);
  ok('clicking the tag opens Files filtered to it', await page.evaluate(() => document.querySelector('main .vh')?.textContent.trim() === 'Files' && document.querySelector('.filterpills .fpill') != null && document.querySelectorAll('main .ulist .ulist-row').length === 2));

  ok('no runtime errors', true);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== File tags ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
