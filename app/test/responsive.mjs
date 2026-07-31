// Layout regression guard for the fixed bottom file-status bar (FileSaveBanner
// — see Reader.svelte's --filestatus-h/.has-filestatus wiring). This exists
// because a CSS-specificity mistake in that wiring once passed every other
// test, looked fine on a desktop screenshot, and then broke the *mobile*
// layout (the sticky rail's height override leaked past its own media query
// and forced a near-viewport height onto what should be a slim horizontal
// tab bar). Screenshots don't catch that class of bug reliably enough on
// their own — this asserts on real geometry (getBoundingClientRect) at both
// a desktop and a phone viewport, so a regression here fails the suite
// instead of surfacing as "the whole app looks broken" during manual testing.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

async function addPersonAndTriggerFilestatus(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('nav button, .navlink-section')].length > 0 || !!document.querySelector('.mobilenav-toggle'), { timeout: 8000 });
  // People may live in a static rail (desktop) or an off-canvas drawer
  // (mobile) — open the drawer first if that's how this viewport shows nav.
  await page.evaluate(() => document.querySelector('.mobilenav-toggle')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.navlink-section')].some((b) => b.textContent.includes('People')), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', 'ZZ Responsive Test');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!document.querySelector('.filestatus'), { timeout: 6000 });
}

const rect = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
}, sel);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });

// ---- Desktop viewport ----
try {
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(FILE, { waitUntil: 'load' });
  await addPersonAndTriggerFilestatus(page);

  const bar = await rect(page, '.filestatus');
  const settings = await rect(page, '[aria-label="Settings"]');
  const nav = await rect(page, '.nav');
  const vh = await page.evaluate(() => window.innerHeight);

  ok('desktop: file-status bar renders at the bottom edge', bar && bar.bottom >= vh - 2);
  ok('desktop: file-status bar stays thin (not a giant overlay)', bar && bar.height < 80);
  ok('desktop: Settings button fully clears the file-status bar', settings && bar && settings.bottom <= bar.top + 1);
  ok('desktop: guide nav column fully clears the file-status bar', nav && bar && nav.bottom <= bar.top + 1);
  ok('desktop: no runtime errors', errs.length === 0);
  await page.close();
} catch (e) { ok('desktop flow threw: ' + e.message, false); }

// ---- iPhone 14 Pro viewport ----
try {
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(FILE, { waitUntil: 'load' });
  await addPersonAndTriggerFilestatus(page);

  const bar = await rect(page, '.filestatus');
  const actionbarIn = await rect(page, '.actionbar-in');
  const toggle = await rect(page, '.mobilenav-toggle');
  const vh = await page.evaluate(() => window.innerHeight);
  const vw = await page.evaluate(() => window.innerWidth);

  ok('mobile: file-status bar renders and stays thin', bar && bar.height > 0 && bar.height < 80);
  ok('mobile: file-status bar does not cover most of the screen', bar && bar.top > vh * 0.7);
  // This is the exact assertion that would have caught the specificity bug:
  // a leaked desktop height rule turns this into a near-viewport-height box
  // instead of a slim horizontal tab bar.
  ok('mobile: bottom tab bar (.actionbar-in) stays a slim strip, not a near-full-height box', actionbarIn && actionbarIn.height > 0 && actionbarIn.height < 120);
  ok('mobile: bottom tab bar sits below the file-status bar (which sits just above it), no overlap', actionbarIn && bar && actionbarIn.top >= bar.bottom - 1);
  ok('mobile: menu toggle is visible near the top of the screen, not pushed off-screen', toggle && toggle.top >= 0 && toggle.top < vh * 0.3);
  ok('mobile: nothing overflows the viewport width (no horizontal scroll of the shell)', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok('mobile: no runtime errors', errs.length === 0);
  await page.close();
} catch (e) { ok('mobile flow threw: ' + e.message, false); }

await browser.close();

console.log('\n=== Responsive layout guard (file-status bar × desktop/mobile) ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
