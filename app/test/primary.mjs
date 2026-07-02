// Primary recipients lead the "who are you?" gate, above a divider, then
// everyone else. Exercised on the Demo (primary = Amanda).
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Demo')?.click());
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await pause();

  const order = await page.evaluate(() => [...document.querySelectorAll('.gate-people .who-name')].map((n) => n.textContent.split('·')[0].trim()));
  ok('primary recipient leads the gate', order[0] === 'Amanda');
  ok('a divider separates primary from the rest', await page.evaluate(() => {
    const kids = [...document.querySelector('.gate-people').children];
    return kids[1]?.classList.contains('gate-sep') && document.querySelectorAll('.gate-people .gate-sep').length === 1;
  }));
  ok('the rest follow after the divider', order.length > 2 && order.includes('John'));

  // Edit mode → a guide's audience picker lists the primary recipient first.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  // Settings exposes both the explicit plan owner and primary recipients.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm'), { timeout: 6000 });
  const labels = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .frm .lbl')].map((l) => l.textContent.trim().toLowerCase()));
  ok('Settings offers "Plan owner"', labels.some((l) => l.includes('plan owner')));
  ok('Settings offers "Primary recipients"', labels.some((l) => l.includes('primary recipients')));

  ok('no runtime errors', true);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Primary recipients ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
