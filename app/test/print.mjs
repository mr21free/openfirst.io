// Print hygiene, plus a guard on draft-guide visibility for a reopened file:
//   1) A draft guide IS visible in the nav once "Admin" is chosen for a
//      reopened file — the owner reading their own plan (not impersonating
//      a specific heir, not a genuine read-only file) can see drafts, same
//      as during live editing. Only an actual heir — previewing as a
//      specific person, or a real read-only exported file — never sees one.
//   2) The "Not available in <LANG> — showing the <other> version instead."
//      language-fallback notice must be visible on screen and gone on
//      paper. Verified via print-media emulation.
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
  package: { title: 'Print test', languages: ['en', 'sk'], primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  locations: [{ id: 'loc1', name: 'Home' }],
  items: [{ id: 'i1', name: 'Passport', location_ids: ['loc1'], tags: ['travel'] }],
  guides: [
    { id: 'g_draft', title: 'Draft note', draft: true, audience_person_ids: ['p1'], content: { en: 'Draft body.', sk: 'Koncept.' } },
    { id: 'g_en', title: 'EN only', audience_person_ids: ['p1'], content: { en: 'Only English here.' } }
  ]
};

const dir = mkdtempSync(resolve(tmpdir(), 'lp-print-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

const openGuide = (t) => page.evaluate((t) => [...document.querySelectorAll('nav .navlink')].find((b) => b.textContent.trim() === t)?.click(), t);
const noticeDisplay = () => page.evaluate(() => {
  const n = document.querySelector('main .notice');
  return n ? getComputedStyle(n).display : '__missing__';
});

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  // --- DRAFT GUIDE VISIBLE TO ADMIN IN THE REOPENED FILE'S READER ---
  const navTitles = await page.evaluate(() => [...document.querySelectorAll('nav .navlink')].map((b) => b.textContent.trim()));
  ok('draft guide is visible to admin in the nav', navTitles.includes('Draft note'));
  ok('the published guide is still there', navTitles.includes('EN only'));

  // --- FALLBACK NOTICE ---
  await page.select('select.lang', 'sk');
  await pause(200);
  await openGuide('EN only');
  await page.waitForFunction(() => /version instead/i.test(document.body.innerText), { timeout: 6000 });
  await pause();
  await page.emulateMediaType('screen');
  ok('fallback notice is visible on screen', (await noticeDisplay()) !== 'none' && (await noticeDisplay()) !== '__missing__');
  await page.emulateMediaType('print');
  ok('fallback notice is hidden when printing', (await noticeDisplay()) === 'none');

  // --- PRINT DISABLED WHILE EDITING ---
  // Printing an edit surface produces a broken page; the button must be a
  // dead end in edit mode and come back in view mode. (Regression guard.)
  const printState = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Print');
    return b ? { disabled: b.disabled, tip: b.getAttribute('data-tip') } : null;
  });
  ok('print button enabled in view mode', (await printState())?.disabled === false);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Edit')?.click());
  await pause(300);
  const inEdit = await printState();
  ok('print button disabled in edit mode', inEdit?.disabled === true);
  ok('disabled print explains itself', /view mode/i.test(inEdit?.tip || ''));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Done editing')?.click());
  await pause(300);
  ok('print button re-enabled after editing', (await printState())?.disabled === false);

  // --- MAP TAG FILTER: filter controls hidden on paper, applied tag(s) shown as plain text ---
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.trim() === 'Map')?.click());
  await page.waitForFunction(() => !!document.querySelector('main .map'), { timeout: 6000 });
  await pause();
  await page.evaluate(() => document.querySelector('main .map .filterbtn')?.click()); await pause(150);
  await page.evaluate(() => document.querySelector('main .map .filterpop .facet .facet-opt input')?.click()); await pause(300);
  await page.emulateMediaType('screen');
  ok('map filter bar visible on screen', await page.evaluate(() => getComputedStyle(document.querySelector('main .map .filterbar')).display !== 'none'));
  ok('print-only tag summary hidden on screen', await page.evaluate(() => getComputedStyle(document.querySelector('main .map .print-only')).display === 'none'));
  await page.emulateMediaType('print');
  ok('map filter bar hidden when printing', await page.evaluate(() => getComputedStyle(document.querySelector('main .map .filterbar')).display === 'none'));
  ok('printed page states the applied tag as plain text', await page.evaluate(() => {
    const p = document.querySelector('main .map .print-only');
    return !!p && getComputedStyle(p).display !== 'none' && p.textContent.includes('travel');
  }));
  await page.emulateMediaType('screen');

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Print hygiene (draft hiding + fallback notice) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
