// Staleness banner: shows for a stale plan in edit mode, and a dismissal
// SURVIVES the edit/read toggle (regression: the banner lives inside
// {#if editing}, so remounting must not resurrect it within a session).
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// Old, substantial, never dry-run → every staleness trigger fires.
const fixture = {
  schema: 'lifepackage/v1',
  package: { id: 'stale-1', title: 'Stale plan', owner_id: 'p1', created: '2024-01-01', updated: '2024-06-01', languages: ['en'], default_language: 'en' },
  people: [
    { id: 'p1', name: 'Owner' }, { id: 'p2', name: 'Heir' }, { id: 'p3', name: 'Helper' }
  ],
  items: [
    { id: 'i1', name: 'Bank account' }, { id: 'i2', name: 'Will' }, { id: 'i3', name: 'Wallet' }
  ],
  guides: [{ id: 'g1', title: 'First steps', audience_person_ids: ['p2'], content: { en: 'Take your time.' } }]
};

const dir = mkdtempSync(resolve(tmpdir(), 'lp-stale-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

const banner = () => page.evaluate(() => !!document.querySelector('.stalebar'));
const clickAria = (label) => page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === l)?.click(), label);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navlink'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  ok('banner hidden in read mode', !(await banner()));
  await clickAria('Edit'); await pause();
  ok('stale plan shows the banner in edit mode', await banner());

  await clickAria('Dismiss'); await pause(200);
  ok('X dismisses the banner', !(await banner()));

  // The regression: read → edit again must NOT resurrect it this session.
  await clickAria('Done editing'); await pause();
  await clickAria('Edit'); await pause();
  ok('dismissal survives the edit/read toggle', !(await banner()));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Staleness banner (dismiss persistence) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
