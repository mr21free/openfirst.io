// End-to-end smoke test: drives the built single-file app in the system browser,
// over file://, to confirm the core Reader flow works offline.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

const clickByText = (text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(t));
    if (b) { b.click(); return true; }
    return false;
  }, text);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  ok('landing renders', true);

  // Load the bundled sample
  await clickByText('Demo');
  await page.waitForFunction(() => document.body.innerText.includes('who are you'), { timeout: 8000 });
  const gateText = await page.evaluate(() => document.body.innerText);
  ok('who-are-you gate shows owner (John James)', gateText.includes('John James'));
  ok('gate lists an audience (Amanda)', gateText.includes('Amanda'));

  // Choose the primary heir
  await clickByText('Amanda');
  await page.waitForFunction(() => /Message for Amanda/.test(document.querySelector('main h2')?.textContent || ''), { timeout: 8000 });
  const startText = await page.evaluate(() => document.querySelector('main article')?.innerText || '');
  ok('reader shows Amanda her personal message first', startText.includes('Amanda,') && startText.includes('I trust you'));

  // Person switcher (top bar) changes who you read as
  await page.select('.sel-wrap select', '__all');
  await page.waitForFunction(() => [...document.querySelectorAll('nav .navlink-section')].some((b) => b.textContent.includes('Items')), { timeout: 6000 });
  ok('person switcher changes who you read as', true);

  // The dark/light icon is a read-only (heir package) control; the builder uses Settings → Appearance.
  ok('builder shows no dark/light toggle icon', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '') === 'Toggle dark mode'))));

  ok('nav has a guide (Bitcoin)', (await page.evaluate(() => document.body.innerText)).includes('Bitcoin'));

  // Open the "First steps" guide — it links to other guides via explicit [[id]]
  // references, the ONLY thing that creates cross-links (plain prose never
  // auto-links). Referenced guides also show their importance inline.
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink')].find((b) => /First steps for Amanda/.test(b.textContent))?.click());
  await page.waitForFunction(() => /First steps for Amanda/.test(document.querySelector('main h2')?.textContent || ''), { timeout: 8000 });
  ok('guide content renders (First steps)', true);

  // Cross-link: clicking an xref either opens a drawer (entity) or navigates
  // (when the link targets another guide). Either is correct.
  const xrefInfo = await page.evaluate(() => ({
    has: !!document.querySelector('main .prose a.xref'),
    imp: document.querySelector('main .prose .xref-imp')?.textContent || ''
  }));
  ok('explicit references render as cross-links', xrefInfo.has);
  ok('referenced guide shows its importance inline', /\[Importance: (high|medium|low)\]/.test(xrefInfo.imp));
  if (xrefInfo.has) {
    const beforeH = await page.evaluate(() => document.querySelector('main h2')?.innerText || '');
    await page.evaluate(() => document.querySelector('main .prose a.xref').click());
    await page.waitForFunction(
      (bh) => !!document.querySelector('[role="dialog"]') || (document.querySelector('main h2')?.innerText || '') !== bh,
      { timeout: 5000 },
      beforeH
    );
    ok('cross-link click responds (drawer or navigate)', true);
    await page.evaluate(() => document.querySelector('.scrim')?.click()); // close drawer if open
  }

  // Items view (unified list) and open an item -> entity drawer
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Items'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Items', { timeout: 6000 });
  ok('items view is a unified list', true);

  await page.evaluate(() => document.querySelector('main .ulist .ulist-click')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"]'), { timeout: 5000 });
  const drawerText = await page.evaluate(() => document.querySelector('[role="dialog"]').innerText);
  ok('entity drawer opens with details', drawerText.length > 20);
  await page.evaluate(() => document.querySelector('.scrim')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 3000 });

  // The John James demo deliberately ships JSON-only, so Files is not shown.
  ok('JSON-only demo hides the Files section', !(await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].some((b) => b.textContent.includes('Files')))));

  // Locations (nested) + People views
  await clickByText('Locations');
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Locations', { timeout: 6000 });
  const indented = await page.evaluate(() => !!document.querySelector('main .ulist .loc-row.nested'));
  ok('locations view renders nested (indented children)', indented);

  await clickByText('People');
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People' && document.body.innerText.includes('Amanda James'), { timeout: 6000 });
  ok('people view is a unified list', true);

  ok('to-print section is not shown', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('To print')))));

  // --- Encrypted package flow ---  (brand = home)
  await page.click('.brand-home');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 6000 });

  const fileInput = await page.$('input[type=file]:not([webkitdirectory])');
  await fileInput.uploadFile(resolve(__dirname, '../public/sample-package.encrypted.json'));
  await page.waitForFunction(() => document.body.innerText.includes('This plan is protected'), { timeout: 6000 });
  ok('encrypted package prompts for password', true);

  // Wrong password is rejected
  await page.click('.pw', { clickCount: 3 });
  await page.type('.pw', 'definitely-wrong');
  await clickByText('Unlock');
  await page.waitForFunction(() => /didn.t work/i.test(document.body.innerText), { timeout: 10000 });
  ok('wrong password rejected', true);

  // Correct password unlocks and loads the reader (lands on the "who are you?" gate)
  await page.click('.pw', { clickCount: 3 });
  await page.type('.pw', 'open-sesame-2026');
  await clickByText('Unlock');
  await page.waitForFunction(
    () => /who are you/i.test(document.body.innerText) && document.body.innerText.includes('Amanda'),
    { timeout: 12000 }
  );
  ok('correct password unlocks + loads reader', true);

  ok('no runtime errors', errors.length === 0);
} catch (e) {
  ok('flow completed without throwing: ' + e.message, false);
} finally {
  await browser.close();
}

console.log('\n=== Reader smoke test ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n  runtime errors:'); errors.forEach((e) => console.log('   - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length} checks)\n`);
process.exit(failed ? 1 : 0);
