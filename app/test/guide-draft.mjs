// Draft / publish guides: a guide can be flagged draft (kept in the working
// plan, marked in the tree) and is then excluded — along with any group it
// would leave empty — from heir-facing exports.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const dir = mkdtempSync(resolve(tmpdir(), 'lp-draft-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const cdp = await page.target().createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (b) { b.click(); return true; } return false; }, t);
// "+ New" opens a menu with Guide/Group sub-options — click it, then the option.
const newGuide = async () => { await click('+ New'); await page.evaluate(() => [...document.querySelectorAll('.newpop button')].find((b) => b.textContent.includes('Guide'))?.click()); };
const newGroup = async () => { await click('+ New'); await page.evaluate(() => [...document.querySelectorAll('.newpop button')].find((b) => b.textContent.includes('Group'))?.click()); };
const openGuide = (name) => page.evaluate((name) => { const i = [...document.querySelectorAll('nav .navrow input')].find((i) => i.value === name); if (i) { i.click(); return true; } return false; }, name);
const toggleDraft = () => page.evaluate(() => { const b = document.querySelector('main .gtool-pub'); if (b) { b.click(); return true; } return false; });
const intoGroup = (g) => page.evaluate((g) => { const G = [...document.querySelectorAll('nav .navgroup')].find((n) => (n.querySelector('.navgroup-title input')?.value ?? n.querySelector('.navgroup-title')?.textContent.trim()) === g); const dt = new DataTransfer(); G.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt })); G.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); }, g);
const startRoot = (name) => page.evaluate((name) => { const r = [...document.querySelectorAll('nav > .navrow')].find((r) => (r.querySelector('input')?.value ?? '') === name); if (r) (r.querySelector('.navguide-grip') || r).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); }, name);
const pause = (ms = 180) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await click('Create new plan');
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });

  // A second group with two guides (all later flagged draft) + one published root guide.
  await newGroup(); await pause();
  await newGuide(); await pause(); await startRoot('New Guide'); await intoGroup('New group'); await pause();
  await newGuide(); await pause(); await startRoot('New Guide (1)'); await intoGroup('New group'); await pause();
  await newGuide(); await pause(); // New Guide (2): published root guide

  await openGuide('New Guide'); await pause(); await toggleDraft(); await pause();
  ok('toggle flags the guide draft (button state + banner)', await page.evaluate(() => !!document.querySelector('main .gtool-pub.is-draft') && !!document.querySelector('main .draft-banner')));

  // Toggling back publishes it again.
  await toggleDraft(); await pause();
  ok('toggling again republishes (banner gone)', await page.evaluate(() => !document.querySelector('main .gtool-pub.is-draft') && !document.querySelector('main .draft-banner')));

  // The explainer is dismissible and stays dismissed (localStorage): once the
  // user knows what a draft is, only the frame + amber icon mark drafts.
  await page.evaluate(() => document.querySelector('main .gtool-pub')?.click()); await pause();
  ok('draft again shows the explainer', await page.evaluate(() => !!document.querySelector('main .draft-banner')));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Dismiss draft explanation')?.click()); await pause(200);
  ok('explainer dismisses', await page.evaluate(() => !document.querySelector('main .draft-banner')));
  await page.evaluate(() => document.querySelector('main .gtool-pub')?.click()); await pause();
  await page.evaluate(() => document.querySelector('main .gtool-pub')?.click()); await pause();
  ok('dismissal sticks across re-drafting (icon still marks it)', await page.evaluate(() => !document.querySelector('main .draft-banner') && !!document.querySelector('main .gtool-pub.is-draft')));
  await page.evaluate(() => document.querySelector('main .gtool-pub')?.click()); await pause(); // republish for the rest of the test
  await toggleDraft(); await pause(); // back to draft

  await openGuide('New Guide (1)'); await pause(); await toggleDraft(); await pause();
  ok('nav marks every draft guide (draft icon, both modes)', await page.evaluate(() => document.querySelectorAll('nav .navrow.is-draft .draft-mark svg').length === 2));

  // Export the self-contained heir reader (no password) and inspect the baked-in payload.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  ok('export dialog notes the withheld drafts', await page.evaluate(() => /draft.*not included/i.test(document.querySelector('[role="dialog"] .reader-note')?.textContent || '')));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Export')?.click());

  // Filename now carries the plan title + date (like the .zip/.encrypted.json
  // exports), so match by suffix rather than the old exact name.
  const findOut = () => readdirSync(dir).find((f) => f.endsWith('_start-here.html'));
  let waited = 0; while (!findOut() && waited < 8000) { await pause(150); waited += 150; }
  const readerFile = findOut();
  ok('start-here.html produced', !!readerFile);

  const html = readerFile ? readFileSync(resolve(dir, readerFile), 'utf8') : '';
  const m = html.match(/window\.__LIFE_PACKAGE__=(\{.*?\});<\/script>/s);
  let payload = null; try { payload = JSON.parse(m[1]); } catch (_) {}
  const guides = payload?.data?.guides || [];
  const groups = payload?.data?.guide_groups || [];
  ok('export omits draft guides', guides.length === 2 && guides.every((g) => !g.draft));
  ok('export keeps published guides (Start here + New Guide (2))', guides.some((g) => g.title === 'Start here') && guides.some((g) => g.title === 'New Guide (2)'));
  ok('export drops the now-empty group + leaves no orphan group refs', !groups.some((g) => g.name === 'New group') && guides.every((g) => !g.group || groups.some((x) => x.id === g.group)));

  // A successful export hands off to the review-reminder follow-up dialog — dismiss it.
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'No thanks')?.click());

  // The plain .zip (owner's record) must KEEP drafts and their group.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  await page.evaluate(() => { const cb = [...document.querySelectorAll('[role="dialog"] .toggle input')][0]; if (cb && cb.checked) cb.click(); }); // turn OFF self-contained reader
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Export')?.click());
  let zipName = null, zw = 0;
  while (!(zipName = readdirSync(dir).find((f) => f.endsWith('.zip'))) && zw < 8000) { await pause(150); zw += 150; }
  ok('.zip produced', !!zipName);
  let zguides = [], zgroups = [];
  if (zipName) {
    const files = unzipSync(new Uint8Array(readFileSync(resolve(dir, zipName))));
    const key = Object.keys(files).find((k) => k.endsWith('lifepackage.json'));
    const zdata = JSON.parse(strFromU8(files[key]));
    zguides = zdata.guides || []; zgroups = zdata.guide_groups || [];
  }
  ok('.zip keeps draft guides (all 4) ', zguides.length === 4 && zguides.filter((g) => g.draft).length === 2);
  ok('.zip keeps the all-draft group', zgroups.some((g) => g.name === 'New group'));

  ok('no runtime errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Guide draft / publish ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
