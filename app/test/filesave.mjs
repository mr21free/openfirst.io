// File-autosave (iteration 2a, Container Format v1 — see FORMAT.md /
// planfile.js): create a plan, add a person (homing trigger), use the
// fallback "Download" path (headless Chrome has no
// showSaveFilePicker, so this is the path this harness can actually
// exercise), and confirm the produced .html is a genuine, complete
// container-v1 file that boots correctly as a read-only reader on its own.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const clickText = (page, t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(t)); if (b) { b.click(); return true; } return false; }, t);

const dir = mkdtempSync(resolve(tmpdir(), 'lp-filesave-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });

// This Chrome build does expose window.showSaveFilePicker, but headless has no
// OS-level file-save dialog for automation to drive — so force the no-FSA
// fallback branch (deterministically exercisable end-to-end) by removing the
// API before any app script runs.
await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });

try {
  await page.goto(FILE, { waitUntil: 'load' });
  ok('fallback path is force-selected for this run (no showSaveFilePicker)', !(await page.evaluate(() => 'showSaveFilePicker' in window)));

  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await clickText(page, 'Create new plan');
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
  ok('new plan lands directly in edit mode', true);

  ok('no status bar yet (no entity added)', !(await page.evaluate(() => !!document.querySelector('.filestatus'))));

  // Add a person — the homing trigger (Store#addPerson sets hasAddedEntity).
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', 'ZZ Test Heir');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Test Heir'), { timeout: 6000 });

  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  ok('adding an entity surfaces the homing prompt', true);
  const promptLabel = await page.evaluate(() => document.querySelector('.filestatus.warn button')?.textContent.trim());
  ok('fallback prompt offers "Download"', promptLabel === 'Download');

  await page.evaluate(() => document.querySelector('.filestatus.warn button')?.click());

  const findOut = () => readdirSync(dir).find((f) => f.endsWith('.html'));
  let waited = 0;
  while (!findOut() && waited < 8000) { await new Promise((r) => setTimeout(r, 150)); waited += 150; }
  const outName = findOut();
  ok('a container-v1 .html was downloaded', !!outName);
  ok('file name is derived from the plan title, no date/suffix stamped', outName === 'My_plan.html');
  const outPath = resolve(dir, outName || 'My_plan.html');

  await page.waitForFunction((name) => document.querySelector('.filestatus.ok')?.textContent.includes(name), { timeout: 6000 }, outName || 'My_plan.html');
  ok('status line shows the file name once saved', true);

  // A second edit should mark the fallback file behind, with a manual update button.
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', 'ZZ Second Heir');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Second Heir'), { timeout: 6000 });
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  ok('a later edit shows "behind by N changes" with a manual update button (no live handle)', await page.evaluate(() => /behind by/.test(document.querySelector('.filestatus.warn')?.textContent || '')));

  // Open the originally-downloaded file fresh: it must stand alone as a
  // read-only reader, with no dependency on this page/session. This fixture
  // has no addressed guides, so pkg.audiences() is empty and the reader
  // skips straight past the "who are you?" gate into the full read view —
  // that's existing Reader.svelte behavior, not something this iteration
  // changes, so assert on the nav/content landing directly instead.
  const p2 = await browser.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto('file://' + outPath, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  ok('produced file boots standalone as a reader', true);
  ok('produced file\'s nav reflects the added person (People: 2)', await p2.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.textContent.includes('2')));
  await p2.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await p2.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  ok('produced file shows the plan\'s actual content (the added person)', await p2.evaluate(() => document.body.innerText.includes('ZZ Test Heir')));
  ok('produced file was not homed with the second, undownloaded edit', !(await p2.evaluate(() => document.body.innerText.includes('ZZ Second Heir'))));
  ok('produced file reader is read-only (no edit affordance)', !(await p2.evaluate(() => !!document.querySelector('.plan-edit, [aria-label="Edit"]'))));
  ok('produced file has no script pageerrors', errs2.length === 0);
  await p2.close();

  ok('no runtime errors on the builder page', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== File-autosave (fallback download) loop ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
