// Iteration 2b's launcher split: a plan homed via the no-FSA fallback download
// path (headless Chrome has no showSaveFilePicker/showOpenFilePicker for
// automation to drive, so this is the only file-connection path this harness
// can exercise end-to-end) must show up under "recent plans", not the old
// undifferentiated "unsaved" draft list — and its Resume button must still
// resume the plan correctly (from IndexedDB, since there's no live handle).
// A never-homed plan must still show up under "unsaved" with working Restore.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const clickText = (page, sel, t) => page.evaluate((sel, t) => { const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().includes(t)); if (b) { b.click(); return true; } return false; }, sel, t);

const dir = mkdtempSync(resolve(tmpdir(), 'lp-filesave-reopen-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const addPerson = async (name) => {
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', name);
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 6000 }, name);
};

try {
  await page.goto(FILE, { waitUntil: 'load' });

  // A never-homed plan first, so both lists are non-empty when we check the split.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await clickText(page, 'button', 'Create new plan');
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
  await addPerson('ZZ Unsaved Plan Person');
  await pause(900); // let the 600ms autosave debounce write the draft to IndexedDB
  await page.click('button[aria-label="Back to start"]');
  // The launcher's draft list re-checks IndexedDB asynchronously each time it's
  // shown (App.svelte's boot $effect) — it can lag a beat behind the "Create
  // new plan" button itself reappearing, so poll rather than checking once.
  await page.waitForFunction(() => document.body.innerText.includes('Browser storage'), { timeout: 8000 });
  ok('never-homed plan appears under "unsaved" (Browser storage)', true);

  // Now a homed (fallback-download) plan.
  await clickText(page, 'button', 'Create new plan');
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
  await addPerson('ZZ Recent Plan Person');
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  await page.evaluate(() => document.querySelector('.filestatus.warn button')?.click());
  await page.waitForFunction(() => /My_plan/.test(document.querySelector('.filestatus.ok')?.textContent || ''), { timeout: 6000 });
  await pause(900); // let the 600ms autosave debounce write the draft to IndexedDB

  await page.click('button[aria-label="Back to start"]');
  await page.waitForFunction(() => document.body.innerText.includes('My_plan'), { timeout: 8000 });

  ok('homed plan appears under "recent" (file name shown), not "Browser storage"', true);
  // "Resume" is used by both the recent-plans row and the plain draft row
  // (wording is unified) — scope the click to the card that mentions the
  // saved file, not just the first "Resume" button on the page.
  const clickRecentResume = () => page.evaluate(() => {
    const card = [...document.querySelectorAll('.draft')].find((c) => c.textContent.includes('My_plan'));
    const btn = [...(card?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === 'Resume');
    if (btn) { btn.click(); return true; }
    return false;
  });
  ok('homed plan\'s recent row offers Resume', await page.evaluate(() => {
    const card = [...document.querySelectorAll('.draft')].find((c) => c.textContent.includes('My_plan'));
    return [...(card?.querySelectorAll('button') || [])].some((b) => b.textContent.trim() === 'Resume');
  }));
  ok('exactly one "unsaved" row remains (the never-homed plan only)', await page.evaluate(() =>
    [...document.querySelectorAll('.draft')].filter((c) => c.textContent.includes('Browser storage')).length === 1
  ));

  await clickRecentResume();
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  ok('Resume resumes the homed plan with its actual content', await page.evaluate(() => document.body.innerText.includes('ZZ Recent Plan Person')));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Launcher reopen split (2b) ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
