// Pickers/selectors list entities A→Z by name (case-insensitive, natural) so
// long lists are easy to scan. Items, people, guides — locations stay
// hierarchical. Verified on the item form's "Depends on" (items), "Who can
// access" (people) and "What is stored here" reverse picker.
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
const sortedCI = (a) => [...a].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Sort test' },
  people: [{ id: 'p_zoe', name: 'Zoe' }, { id: 'p_ann', name: 'ann' }, { id: 'p_mike', name: 'Mike' }],
  locations: [{ id: 'loc1', name: 'Home' }],
  items: [
    { id: 'i_zeb', name: 'Zebra widget' },
    { id: 'i_app', name: 'apple gadget' },
    { id: 'i_man', name: 'Mango box' }
  ],
  guides: [{ id: 'g1', title: 'Intro', audience_person_ids: ['p_ann'], content: { en: 'See items.' } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-sort-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

// Item-option text from a labelled picker (drops the placeholder + price suffixes).
const pickerOptions = (label) => page.evaluate((label) => {
  const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === label);
  return [...(f?.querySelectorAll('option') || [])].map((o) => o.textContent.trim()).filter((t) => t && !/^(Add |Change…|—)/.test(t));
}, label);
const openItem = async (nameRe) => {
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Items/.test(b.textContent))?.click());
  await pause(250);
  await page.evaluate((re) => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => new RegExp(re).test(r.textContent))?.click(), nameRe);
  await page.waitForFunction(() => !!document.querySelector('.drawer .frm'), { timeout: 6000 });
  await pause(200);
};

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);

  await openItem('Mango box');
  const deps = await pickerOptions('Depends on');
  ok('items in a picker are A→Z (case-insensitive)', JSON.stringify(deps) === JSON.stringify(sortedCI(deps)) && deps[0] === 'apple gadget' && deps.includes('Zebra widget'));

  const people = await pickerOptions('Who can access');
  ok('people in a picker are A→Z (case-insensitive)', JSON.stringify(people) === JSON.stringify(sortedCI(people)) && people[0] === 'ann');
  await page.evaluate(() => document.querySelector('.scrim')?.click()); await pause(200);

  // The user's case: a location's "What is stored here" reverse picker, A→Z.
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Locations/.test(b.textContent))?.click());
  await pause(250);
  await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => /Home/.test(r.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.drawer .frm'), { timeout: 6000 });
  await pause(200);
  const stored = await pickerOptions('What is stored here');
  ok('"What is stored here" lists items A→Z', JSON.stringify(stored) === JSON.stringify(sortedCI(stored)) && stored[0] === 'apple gadget');

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Pickers ordered A→Z ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
