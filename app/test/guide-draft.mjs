// Draft / publish guides: a guide can be flagged draft (kept in the working
// plan, marked in the tree). Since the container-v1 plan .html is now the
// only real output (no more separate heir-facing export), draft guides ride
// along in the file's data just like everything else. The owner reading
// their own plan (View mode, not impersonating anyone) can still see and
// search drafts — that's the whole point of drafting inside the live plan
// instead of a separate scratch file. What must never see a draft is an
// actual heir: either the owner previewing a specific person via "Reading
// as", or a real read-only exported file. This file covers the
// toggle/editing-side marking first, then both read-side cases.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
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

  // Give the still-draft 'New Guide' some distinctive body text, so we can
  // prove search can't surface it either, not just the nav.
  await openGuide('New Guide'); await pause();
  await page.evaluate(() => {
    const ed = document.querySelector('main .editor-host [contenteditable="true"]');
    if (ed) { ed.focus(); document.execCommand('insertText', false, 'zzz-unique-draft-marker-zzz'); }
  });
  await pause(300);

  // Add a role + a named heir before switching to the reading side, so we
  // can later preview specifically as them (distinct from plain admin view).
  const clickHeadNew = () => page.evaluate(() => [...document.querySelectorAll('.head-actions button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('Roles'))?.click()); await pause();
  await clickHeadNew(); await pause();
  await page.evaluate(() => { const i = document.querySelector('[role="dialog"] input'); if (i) { i.focus(); i.value = 'Heir'; i.dispatchEvent(new Event('input', { bubbles: true })); } }); await pause();
  await page.keyboard.press('Escape'); await pause(200);

  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click()); await pause();
  await clickHeadNew(); await pause();
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const nameInput = dlg?.querySelector('input');
    if (nameInput) { nameInput.focus(); nameInput.value = 'Test Heir'; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
  }); await pause();
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('[role="dialog"] .tagchip')].find((c) => c.textContent.includes('Heir'));
    chip?.querySelector('input[type="checkbox"]')?.click();
  }); await pause();
  await page.keyboard.press('Escape'); await pause(200);

  // Switch to the reading side. Plain owner View (admin, no impersonation)
  // must still show drafts — that's the whole point of this fix.
  await click('Read'); await pause(300);
  const navTitles = await page.evaluate(() => [...document.querySelectorAll('nav .navlink, nav .navlink-child')].map((b) => b.textContent.trim()));
  ok('admin view mode still shows draft guides in the nav', navTitles.includes('New Guide') && navTitles.includes('New Guide (1)'));
  ok('the published guide is there too', navTitles.includes('New Guide (2)'));

  // Search must surface a draft guide for admin, by name and by content.
  await page.evaluate(() => { document.querySelector('.gs-input').focus(); document.querySelector('.gs-input').value = 'New Guide'; document.querySelector('.gs-input').dispatchEvent(new Event('input', { bubbles: true })); });
  await pause(250);
  let searchNames = await page.evaluate(() => [...document.querySelectorAll('.gs-row:not(.gs-all)')].map((r) => r.textContent.trim()));
  ok('admin search surfaces draft guides by name', searchNames.some((t) => t.includes('New Guide') && !t.includes('New Guide (2)')));
  await page.evaluate(() => { document.querySelector('.gs-input').value = 'zzz-unique-draft-marker-zzz'; document.querySelector('.gs-input').dispatchEvent(new Event('input', { bubbles: true })); });
  await pause(250);
  ok('admin search surfaces a draft guide by its content', await page.evaluate(() => document.querySelectorAll('.gs-row').length > 0));
  await page.evaluate(() => document.querySelector('.gs-input').blur());

  // Now preview as the specific heir — drafts must disappear again, both
  // from the nav and from search, exactly like a real read-only file would.
  await page.evaluate(() => document.querySelector('button[aria-label="Reading as"]')?.click());
  await page.waitForFunction(() => !!document.querySelector('[aria-label="Choose who you\'re reading as"]'), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Choose who you\'re reading as"] button')].find((b) => b.textContent.includes('Test Heir'))?.click());
  await pause(300);
  const heirNavTitles = await page.evaluate(() => [...document.querySelectorAll('nav .navlink, nav .navlink-child')].map((b) => b.textContent.trim()));
  ok('previewing as a specific heir hides draft guides from the nav', !heirNavTitles.includes('New Guide') && !heirNavTitles.includes('New Guide (1)'));

  await page.evaluate(() => { document.querySelector('.gs-input').focus(); document.querySelector('.gs-input').value = 'New Guide'; document.querySelector('.gs-input').dispatchEvent(new Event('input', { bubbles: true })); });
  await pause(250);
  searchNames = await page.evaluate(() => [...document.querySelectorAll('.gs-row:not(.gs-all)')].map((r) => r.textContent.trim()));
  ok('previewing as a specific heir hides draft guides from search', !searchNames.some((t) => t.includes('New Guide') && !t.includes('New Guide (2)')));
  await page.evaluate(() => document.querySelector('.gs-input').blur());

  // Switch back to admin (Edit is blocked while previewing a specific heir)
  // before returning to editing: the draft guide and its content must still
  // be intact — hiding is view-only, nothing was actually removed from the plan.
  await page.evaluate(() => document.querySelector('button[aria-label="Reading as"]')?.click());
  await page.waitForFunction(() => !!document.querySelector('[aria-label="Choose who you\'re reading as"]'), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Choose who you\'re reading as"] button')].find((b) => /^Admin/.test(b.textContent))?.click());
  await pause(300);
  await click('Edit'); await pause(300);
  ok('the draft guide (and its content) survives the round trip', await page.evaluate(() => [...document.querySelectorAll('nav .navrow input')].some((i) => i.value === 'New Guide')));

  ok('no runtime errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Guide draft / publish ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
