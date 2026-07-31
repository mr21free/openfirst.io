// Iteration 6: the version tag + "check for updates" button in FileSaveBanner
// must only ever appear in edit mode — an heir/read-only viewer never needs
// to know the app version (explicit product requirement). It must also
// render the right static v{APP_VERSION} label and move into the
// "checking…" state on click. The real fetch targets the actual production
// https://openfirst.io/version.json (the CSP's one deliberate connect-src
// exception, see vite.config.js) — a genuine round trip against production is
// covered manually, not here; fetch is stubbed below for deterministic
// error/success paths instead.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const { APP_VERSION } = await import(resolve(__dirname, '../src/lib/version.js'));
const { APP_DOMAIN } = await import(resolve(__dirname, '../src/lib/format.js'));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errs = [];

let page;
try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());

  // hasAddedEntity (and so the whole filestatus bar) only flips on once the
  // owner actually adds something themselves — the seeded owner/start-guide
  // don't count. Add a person via the People section to trigger it.
  await page.waitForFunction(() => !!document.querySelector('.navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.head-actions button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('.head-actions button')].find((b) => b.textContent.trim() === '+ New')?.click());

  await page.waitForFunction(() => !!document.querySelector('.fs-version'), { timeout: 5000 })
    .then(() => ok('the version tag renders in edit mode', true))
    .catch(() => ok('the version tag renders in edit mode', false));

  const num = await page.evaluate(() => document.querySelector('.fs-version-num')?.textContent?.trim());
  ok('it shows the current app version', num === `v${APP_VERSION}`);
  const idleLabel = await page.evaluate(() => document.querySelector('.fs-check')?.textContent?.trim());
  ok('the check button starts idle', idleLabel === 'check for updates');

  // Clicking the version number itself must do nothing — only the
  // "check for updates" button is interactive (see FileSaveBanner.svelte).
  await page.evaluate(() => document.querySelector('.fs-version-num').click());
  ok('clicking the version number does not trigger a check', await page.evaluate(() => document.querySelector('.fs-check')?.textContent?.trim()) === 'check for updates');

  // Stub fetch to reject deterministically — the real fetch now targets the
  // actual production https://openfirst.io/version.json (see FileSaveBanner's
  // checkForUpdate), which the CSP permits even under file://, so it would
  // otherwise genuinely succeed/fail depending on the test machine's real
  // network and the real site's current content. This test only cares about
  // the error-handling path, not real connectivity.
  await page.evaluate(() => { window.fetch = async () => { throw new Error('offline'); }; });
  await page.evaluate(() => document.querySelector('.fs-check').click());
  await page.waitForFunction(
    () => document.querySelector('.fs-check')?.textContent?.trim() !== 'check for updates',
    { timeout: 4000 }
  )
    .then(() => ok('clicking it moves out of the idle state', true))
    .catch(() => ok('clicking it moves out of the idle state', false));

  await page.waitForFunction(() => /^couldn't check — /.test(document.querySelector('.fs-check')?.textContent?.trim() || ''), { timeout: 4000 })
    .then(() => ok('a failed check shows an error reason', true))
    .catch(() => ok('a failed check shows an error reason', false));

  // Force the "update available" state by stubbing fetch — real network is
  // unreachable under file://, and the only other route to this state is a
  // live server with a genuinely different published version.json.
  await page.evaluate(() => {
    window.fetch = async () => ({ ok: true, json: async () => ({ version: '2099.01' }) });
  });
  await page.evaluate(() => document.querySelector('.fs-check').click());
  await page.waitForFunction(() => document.querySelector('.fs-check')?.tagName === 'A', { timeout: 4000 })
    .then(() => ok('an available update swaps the check button for a link', true))
    .catch(() => ok('an available update swaps the check button for a link', false));
  const updateLink = await page.evaluate(() => {
    const a = document.querySelector('.fs-check');
    return a && { text: a.textContent.trim(), href: a.getAttribute('href'), target: a.target, rel: a.rel };
  });
  ok('it names the newer version', updateLink?.text === 'v2099.01 available — get it');
  ok('it links to the real site, not a relative/broken path', updateLink?.href === `https://${APP_DOMAIN}/`);
  ok('it opens in a new tab so the current plan is undisturbed', updateLink?.target === '_blank' && updateLink?.rel === 'noopener');

  // Switch to read-only ("Read") mode — the heir/read-only view — and
  // confirm the whole file-status bar, version tag included, disappears.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Read')?.click());
  await page.waitForFunction(() => !document.querySelector('.filestatus'), { timeout: 4000 })
    .then(() => ok('the version tag is absent in read-only/heir view', true))
    .catch(() => ok('the version tag is absent in read-only/heir view', false));
  ok('confirmed via direct query too', await page.evaluate(() => !document.querySelector('.fs-version')));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Version tag + check-for-updates (FileSaveBanner) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
