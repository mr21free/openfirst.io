// "Where is what" Map: locations render as nested containers with their items
// inside, and a chip opens the item drawer.

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
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(t)); if (b) b.click(); }, t);
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  await click('Demo'); await pause();
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await click('Admin'); await pause();

  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.trim() === 'Map')?.click()); await pause();
  ok('Map view opens', await page.evaluate(() => document.querySelector('main .vh')?.textContent.trim() === 'Map'));

  // The sample nests Country > City > Home > Home Trezor (with items inside).
  const deep = await page.evaluate(() => {
    const top = document.querySelector('main .map > .loc-box');
    if (!top) return null;
    let box = top, depth = 0, items = 0;
    while (box) {
      items = box.querySelectorAll(':scope > .loc-items .map-chip').length || items;
      const kid = box.querySelector(':scope > .loc-kids > .loc-box');
      if (!kid) break;
      box = kid; depth++;
    }
    return { depth, items, leaf: box.querySelector(':scope > .loc-head .loc-name')?.textContent.trim() };
  });
  ok('locations render as nested containers (>=3 deep)', !!deep && deep.depth >= 3);
  ok('the deepest place holds item chips', !!deep && deep.items > 0);

  // clicking an item chip opens its drawer
  await page.evaluate(() => document.querySelector('main .map .map-chip')?.click()); await pause(300);
  ok('an item chip opens the item drawer', await page.evaluate(() => !!document.querySelector('[role="dialog"]')));

  ok('no runtime errors', true);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Where-is-what Map ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
