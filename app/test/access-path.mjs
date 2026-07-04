// Access path: the heir's first screen. The sample gives Amanda a 4-step
// physical path — picking her at the gate must land on it (not the guides),
// the nav shows "Your access path", steps link entities, and the person
// drawer offers the printable envelope insert. In edit mode the PersonForm
// has the steps editor.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 950 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Demo')?.click());
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });

  // Pick Amanda — her first screen must be the access path, not the guides.
  await page.evaluate(() => [...document.querySelectorAll('button.who')].find((b) => /Amanda/.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.access'), { timeout: 8000 });
  ok('picking Amanda lands on her access path', true);
  ok('greets her by name', await page.evaluate(() => /Start here, Amanda/i.test(document.querySelector('.access-h')?.textContent || '')));
  ok('shows the 4 steps in order', await page.evaluate(() => {
    const nums = [...document.querySelectorAll('.access-num')].map((n) => n.textContent.trim());
    return nums.join(',') === '1,2,3,4';
  }));
  ok('nav shows "Your access path"', await page.evaluate(() => [...document.querySelectorAll('nav .navlink-access')].some((b) => /access path/i.test(b.textContent))));

  // A step's entity link opens the drawer. (Settle after mount — a real reader
  // reads the steps before clicking; the very first click during hydration can
  // be swallowed.)
  await pause(500);
  await page.evaluate(() => [...document.querySelectorAll('.access-ref')].find((b) => /folder/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.drawer'), { timeout: 6000 });
  ok('step link opens the entity drawer', await page.evaluate(() => /folder/i.test(document.querySelector('.drawer')?.innerText || '')));
  await page.keyboard.press('Escape');
  await pause(300);

  // "Continue to the guides" leaves the path.
  await page.evaluate(() => [...document.querySelectorAll('.access-next button')].find((b) => /continue/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !document.querySelector('.access'), { timeout: 6000 });
  ok('continue leads on to the guides', true);

  // Admin: the person drawer shows the path + the print button; edit mode has the editor.
  await page.evaluate(() => { const sel = document.querySelector('.reader-tools select'); if (sel) { sel.value = '__all'; sel.dispatchEvent(new Event('change', { bubbles: true })); } });
  await pause(300);
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('main .ulist-name')].some((n) => /Amanda/.test(n.textContent)), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .ulist-click')].find((b) => /Amanda/.test(b.textContent))?.click());
  await page.waitForFunction(() => /access path/i.test(document.querySelector('.drawer')?.innerText || ''), { timeout: 6000 });
  ok('person drawer shows the access path section', true);
  // The section holds >3 steps, so it starts collapsed — expand it.
  await page.evaluate(() => {
    const head = [...document.querySelectorAll('.drawer .field-head')].find((h) => /access path/i.test(h.textContent));
    head?.querySelector('.collapse-toggle')?.click();
  });
  await pause(300);
  ok('shows all four steps when expanded', await page.evaluate(() => document.querySelectorAll('.drawer .path-step').length === 4));
  ok('envelope-insert print button present', await page.evaluate(() => [...document.querySelectorAll('.drawer button')].some((b) => /print the envelope insert/i.test(b.textContent))));

  // Edit mode: the PersonForm carries the steps editor.
  await page.keyboard.press('Escape');
  await pause(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Edit')?.click());
  await page.waitForFunction(() => !!document.querySelector('.plan-title-input'), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await pause(300);
  await page.evaluate(() => [...document.querySelectorAll('main .ulist-click')].find((b) => /Amanda/.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm'), { timeout: 6000 });
  ok('edit form has the access-path steps editor', await page.evaluate(() => document.querySelectorAll('[role="dialog"] .step').length === 4));
  // add a step
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '+ Add step')?.click());
  await pause(200);
  ok('adding a step works', await page.evaluate(() => document.querySelectorAll('[role="dialog"] .step').length === 5));
  // remove it again
  await page.evaluate(() => { const steps = [...document.querySelectorAll('[role="dialog"] .step')]; steps[steps.length - 1].querySelector('button[aria-label="Remove step"]')?.click(); });
  await pause(200);
  ok('removing a step works', await page.evaluate(() => document.querySelectorAll('[role="dialog"] .step').length === 4));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Access path ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
