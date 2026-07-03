// Item containment: an item can be "stored inside" one or more container items
// (container_ids) — the digital counterpart of locations. Read view shows
// "Stored inside" on the contained item and "What's inside" on the container;
// the item form offers both pickers; deleting a container leaves no dangling
// reference.
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
  package: { title: 'Containment test', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  items: [
    { id: 'pm', name: 'Password Manager', importance: 'high' },
    { id: 'pin', name: 'Bank PIN', importance: 'medium', container_ids: ['pm'] }
  ]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-cont-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

const field = (label) => page.evaluate((label) => {
  const f = [...document.querySelectorAll('.drawer .dbody .field')].find((x) => x.querySelector('.muted')?.textContent.trim() === label);
  return f ? f.textContent.replace(/\s+/g, ' ').trim() : null;
}, label);
const openItem = async (nameRe, mode = 'read') => {
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Items/.test(b.textContent))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Items', { timeout: 6000 });
  await page.evaluate((re) => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => new RegExp(re).test(r.textContent))?.click(), nameRe);
  await page.waitForFunction((m) => !!document.querySelector(m === 'edit' ? '.drawer .frm' : '.drawer .dbody'), { timeout: 6000 }, mode);
  await pause();
};
const closeDrawer = async () => { await page.evaluate(() => document.querySelector('.scrim')?.click()); await pause(200); };

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });

  // --- READ: contained item shows where it lives; container shows its contents ---
  await openItem('Bank PIN');
  ok('contained item shows "Stored inside" the container', /Stored inside/.test(await field('Stored inside')) && /Password Manager/.test(await field('Stored inside')));
  await closeDrawer();
  await openItem('Password Manager');
  ok('container shows "What\'s inside"', /What's inside/.test(await field("What's inside")) && /Bank PIN/.test(await field("What's inside")));
  await closeDrawer();

  // --- EDIT: both pickers exist; "Stored inside" already holds the container ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await openItem('Bank PIN', 'edit');
  const formLabels = await page.evaluate(() => [...document.querySelectorAll('.drawer .frm .lbl')].map((l) => l.textContent.trim()));
  ok('item form offers a "Stored inside" picker', formLabels.includes('Stored inside (item)'));
  ok('item form offers a "Holds these items" picker', formLabels.includes('Holds these items'));
  const storedChip = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === 'Stored inside (item)');
    return [...(f?.querySelectorAll('.pchip') || [])].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  });
  ok('"Stored inside" picker reflects the saved container', storedChip.some((t) => /Password Manager/.test(t)));
  ok('a container item is not offered as its own container', await page.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === 'Stored inside (item)');
    return ![...(f?.querySelectorAll('option') || [])].some((o) => /Bank PIN/.test(o.textContent));
  }));
  await closeDrawer();

  // --- CLEANUP: deleting the container clears container_ids on the held item ---
  await openItem('Password Manager', 'edit');
  await page.evaluate(() => [...document.querySelectorAll('.drawer .frm button')].find((b) => /^Delete$/.test(b.textContent.trim()))?.click());
  await pause(350);
  if (await page.evaluate(() => !!document.querySelector('[role="alertdialog"]'))) {
    await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => /^Delete$/.test(b.textContent.trim()))?.click());
  }
  await pause(500);
  await openItem('Bank PIN', 'edit');
  ok('deleting the container cleared the dangling container_ids', await page.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === 'Stored inside (item)');
    return [...(f?.querySelectorAll('.pchip') || [])].length === 0;
  }));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Item containment (stored inside / holds) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
