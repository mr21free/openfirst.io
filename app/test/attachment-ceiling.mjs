// Iteration 5, Q5: the ~250MB hard ceiling on attachment growth (store.svelte.js's
// addAttachmentFile) — since .zip export is no longer an overflow escape hatch, a
// file that would push the plan past ~250MB must be refused with a readable error,
// not silently added. A synthetic oversized File (real bytes tiny, `.size`
// overridden) exercises the ceiling check without writing a real 250MB fixture to
// disk or through Puppeteer's upload machinery.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errs = [];

const dropOversizedFile = () => page.evaluate(() => {
  const input = document.querySelector('input[type=file][multiple]');
  const file = new File([new Uint8Array(1)], 'huge-video.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: 260 * 1024 * 1024 });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

let page;
try {
  const dir = mkdtempSync(resolve(tmpdir(), 'lp-ceil-'));
  writeFileSync(resolve(dir, 'small.txt'), 'a real, tiny file');

  page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());
  await page.waitForFunction(() => !!document.querySelector('input[type=file][multiple]'), { timeout: 8000 });

  await dropOversizedFile();
  await page.waitForFunction(() => /Can.t add this file/.test(document.querySelector('#modal-title')?.textContent || ''), { timeout: 4000 })
    .then(() => ok('a file that would push the plan past ~250MB is refused', true))
    .catch(() => ok('a file that would push the plan past ~250MB is refused', false));
  const msg = await page.evaluate(() => document.querySelector('#modal-message')?.textContent || '');
  ok('the refusal explains the ~250MB ceiling and what to do about it', /250MB/.test(msg) && /keep photos and videos small/i.test(msg));
  ok('no attachment was actually added', await page.evaluate(() => {
    const filesRow = [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Files'));
    return !document.querySelector('.drawer .dbody') && filesRow?.querySelector('.navcount')?.textContent.trim() === '0';
  }));
  await page.evaluate(() => document.querySelector('.modal-actions button')?.click());
  await pause(200);

  // Sanity: an ordinary small file still attaches fine — the ceiling check
  // isn't accidentally rejecting everything.
  const inp = await page.$('input[type=file][multiple]:not([webkitdirectory])');
  await inp.uploadFile(resolve(dir, 'small.txt'));
  await page.waitForFunction(() => {
    const filesRow = [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Files'));
    return filesRow?.querySelector('.navcount')?.textContent.trim() === '1';
  }, { timeout: 6000 })
    .then(() => ok('an ordinary small file still attaches normally', true))
    .catch(() => ok('an ordinary small file still attaches normally', false));

  ok('no runtime errors', errs.length === 0);
  rmSync(dir, { recursive: true, force: true });
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Attachment 250MB ceiling ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
