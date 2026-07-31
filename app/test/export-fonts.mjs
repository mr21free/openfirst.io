// The plan .html (container-v1, built by planfile.js) should carry ONLY the
// fonts it renders: the UI mono face plus the plan's chosen guide font. Every
// other bundled family (and its inlined base64) is stripped, keeping the
// file small — this now happens on every autosave/download, not a separate
// "export" action.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../dist/build/index.html');
const FILE = 'file://' + DIST;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

const familiesIn = (html) =>
  new Set([...html.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => {
    const f = /font-family\s*:\s*["']?([^"';}]+)["']?/.exec(m[0]);
    return f ? f[1].trim() : '?';
  }));

// Creates a new plan, sets the guide font in Settings, adds a person (the
// homing trigger), uses the fallback "Download the file" path (headless
// Chrome has no showSaveFilePicker), and returns the path to the produced
// container-v1 .html.
async function buildAndDownload(browser, dir, readingFont) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
  await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.evaluate((font) => {
    const sel = [...document.querySelectorAll('[role="dialog"] select')].find((s) => [...s.options].some((o) => o.value === 'literata'));
    sel.value = font;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, readingFont);
  await page.keyboard.press('Escape');
  await pause();

  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', 'Anna');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  await page.evaluate(() => document.querySelector('.filestatus.warn button')?.click());

  // Every run starts a fresh "Create new plan" (default title "My plan"), so
  // the fallback download is always exactly My_plan.html — matching that
  // exact name (not just any .html) keeps this from re-detecting a previous
  // run's already-renamed-away file still sitting in the same dir.
  const findOut = () => readdirSync(dir).find((f) => f === 'My_plan.html');
  let waited = 0;
  while (!findOut() && waited < 8000) { await pause(); waited += 150; }
  const found = findOut();
  const path = found ? resolve(dir, `plan-${Date.now()}.html`) : null;
  if (path) { writeFileSync(path, readFileSync(resolve(dir, found))); rmSync(resolve(dir, found)); } // rename so the next run is clean
  await page.close();
  return path;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const dir = mkdtempSync(resolve(tmpdir(), 'lp-fonts-'));
const distSize = statSync(DIST).size;

try {
  // Serif pick (Literata): keep UI mono + sans + Literata, drop the other five.
  const litPath = await buildAndDownload(browser, dir, 'literata');
  ok('plan .html produced (literata)', !!litPath);
  if (litPath) {
    const html = readFileSync(litPath, 'utf8');
    const fams = familiesIn(html);
    ok('keeps the UI mono font', fams.has('IBM Plex Mono'));
    ok('keeps the UI sans font', fams.has('IBM Plex Sans'));
    ok('keeps the chosen guide font (Literata)', fams.has('Literata'));
    ok('drops the other serif (Lora)', !fams.has('Lora'));
    ok('drops the unused sans (Inter / Atkinson)', !fams.has('Inter') && !fams.has('Atkinson Hyperlegible'));
    ok('drops the unused Source Serif', !fams.has('Source Serif 4'));
    ok('exactly three families remain', fams.size === 3);
    ok('plan file is meaningfully smaller than the full app', statSync(litPath).size < distSize - 200_000);
  }

  // Mono guide font: no extra reading face, so only the two UI voices remain.
  const monoPath = await buildAndDownload(browser, dir, 'mono');
  if (monoPath) {
    const fams = familiesIn(readFileSync(monoPath, 'utf8'));
    ok('mono plan keeps only the UI voices', fams.size === 2 && fams.has('IBM Plex Mono') && fams.has('IBM Plex Sans'));
    ok('mono plan file is the smallest', statSync(monoPath).size < statSync(litPath).size);
  }
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Plan file bundles only the chosen font ===');
let fail = 0;
for (const [s, n] of results) { if (s === 'FAIL') fail++; console.log(`  [${s}] ${n}`); }
process.exit(fail ? 1 : 0);
