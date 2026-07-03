// You can reference the Map (the "where everything is" view) from a guide:
// "@map" offers it, it inserts as a [[view:map]] chip, and in read mode the
// rendered "Map" link navigates to the map view.
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
  package: { title: 'Map ref', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  locations: [{ id: 'loc1', name: 'Home' }],
  items: [{ id: 'i1', name: 'Safe', location_ids: ['loc1'] }],
  guides: [{ id: 'g1', title: 'Overview', audience_person_ids: ['p1'], content: { en: 'See the [[view:map]] for where everything is.' } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-mapref-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

const openGuideRead = (t) => page.evaluate((t) => [...document.querySelectorAll('nav .navlink')].find((b) => b.textContent.trim() === t)?.click(), t);
const mapNavActive = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('nav .navlink-section')].find((x) => x.textContent.trim() === 'Map');
  return !!b && b.classList.contains('active');
});

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  // --- READ: the Map reference renders as a link and navigates to the map ---
  await openGuideRead('Overview');
  await page.waitForFunction(() => !!document.querySelector('main .prose'), { timeout: 6000 });
  await pause();
  const link = await page.evaluate(() => {
    const a = document.querySelector('main .prose a.viewlink[data-view="map"]');
    return a ? a.textContent.trim() : null;
  });
  ok('a [[view:map]] reference renders as a "Map" link', link === 'Map');
  ok('the map link is not an importance/price-decorated entity ref', await page.evaluate(() =>
    !document.querySelector('main .prose a.viewlink[data-id]')));
  await page.evaluate(() => document.querySelector('main .prose a.viewlink')?.click());
  ok('clicking the Map link navigates to the map view', await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('nav .navlink-section')].find((x) => x.textContent.trim() === 'Map');
    return !!b && b.classList.contains('active');
  }, { timeout: 5000 }).then(() => true).catch(() => false));

  // --- EDIT: "@ Mention" / + Reference offers the Map and inserts a view chip ---
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('nav .navguide-input')].find((i) => i.value === 'Overview')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit'), { timeout: 6000 });
  await pause();
  await page.evaluate(() => [...document.querySelectorAll('.ce .tb-ref')].find((b) => /Mention/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.refpop .refq'), { timeout: 5000 });
  await page.type('.refpop .refq', 'map');
  await pause(250);
  ok('the reference picker offers "Map"', await page.evaluate(() =>
    [...document.querySelectorAll('.refpop .refrow .refname')].some((n) => n.textContent.trim() === 'Map')));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.refpop .refrow')].find((r) => r.querySelector('.refname')?.textContent.trim() === 'Map');
    row?.click();
  });
  await pause(300);
  ok('picking it inserts a Map view chip', await page.evaluate(() => {
    const chip = document.querySelector('.ce-edit .refchip.viewchip-inline');
    return !!chip && chip.dataset.refId === 'view:map' && /Map/.test(chip.textContent);
  }));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Reference the Map from a guide ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
