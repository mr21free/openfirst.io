// A reference chip is contenteditable=false. When it's the FIRST thing on a line
// you previously couldn't place the caret before it to type. The editor now drops
// an invisible zero-width-space guard before such chips so there's a caret slot —
// and strips it on serialize so the saved markdown stays clean.
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
const ZW = '\u200B';

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Chip caret', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  items: [{ id: 'i1', name: 'Home safe' }],
  guides: [{ id: 'g1', title: 'Steps', audience_person_ids: ['p1'], content: { en: '[[i1]] is where it lives.' }, references: { item_ids: ['i1'] } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-chip-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });
  // Enter edit mode and open the guide editor.
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink')].find((b) => b.textContent.trim() === 'Steps')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit .refchip'), { timeout: 8000 });
  await pause();

  // The line-first chip has a zero-width-space guard immediately before it.
  ok('a line-first chip gets a caret-slot guard before it', await page.evaluate((ZW) => {
    const chip = document.querySelector('.ce-edit .refchip');
    const prev = chip.previousSibling;
    return !!prev && prev.nodeType === 3 && prev.nodeValue.includes(ZW);
  }, ZW));

  // Place the caret right before the chip (end of the guard) and type.
  await page.evaluate(() => {
    const ed = document.querySelector('.ce-edit'); ed.focus();
    const chip = ed.querySelector('.refchip'); const guard = chip.previousSibling;
    const r = document.createRange(); r.setStart(guard, guard.length); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.type('Before ');
  await pause(300);

  ok('typing before the chip lands the text in front of it', await page.evaluate(() => {
    const ed = document.querySelector('.ce-edit');
    const chip = ed.querySelector('.refchip');
    // The chip's text node neighbour before it now carries the typed text.
    const txt = ed.textContent.replace(/\u200B/g, '');
    return /^Before\s+Home safe is where it lives\./.test(txt) && txt.indexOf('Before') < txt.indexOf('Home safe');
  }));

  // Navigate away and back → the editor re-renders from the SAVED markdown,
  // proving the zero-width guard was stripped on serialize (clean round-trip).
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await pause(300);
  // In edit mode a guide is a .navguide-input (its title input), not a .navlink.
  await page.evaluate(() => [...document.querySelectorAll('nav .navguide-input')].find((i) => i.value === 'Steps')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit .refchip'), { timeout: 6000 });
  await pause();
  ok('saved markdown round-trips clean (no stray zero-width char)', await page.evaluate(() =>
    document.querySelector('.ce-edit').textContent === 'Before Home safe is where it lives.'));
  ok('the chip survived as a reference after the inserted text', await page.evaluate(() =>
    document.querySelector('.ce-edit .refchip')?.textContent === 'Home safe'));
  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Caret before a line-first chip ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
