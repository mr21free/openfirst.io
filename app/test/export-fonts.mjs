// The self-contained heir reader (start-here.html) should carry ONLY the fonts
// it renders: the UI mono face plus the plan's chosen guide font. Every other
// bundled family (and its inlined base64) is stripped, keeping the export small.
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

const familiesIn = (html) =>
  new Set([...html.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => {
    const f = /font-family\s*:\s*["']?([^"';}]+)["']?/.exec(m[0]);
    return f ? f[1].trim() : '?';
  }));

// Reaches the reader from an uploaded plan, opens Export, creates the reader,
// and returns the path to the produced start-here.html.
async function exportReader(browser, dir, fixture) {
  const fpath = resolve(dir, 'plan.json');
  writeFileSync(fpath, JSON.stringify(fixture));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => !!document.querySelector('button[aria-label="Export"]'), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('button[aria-label="Export"]')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Export')?.click());
  // The reader filename now carries the plan title + date (like the .zip and
  // .encrypted.json exports), so find it by suffix rather than an exact name.
  const findOut = () => readdirSync(dir).find((f) => f.endsWith('_start-here.html'));
  let waited = 0;
  while (!findOut() && waited < 8000) { await new Promise((r) => setTimeout(r, 150)); waited += 150; }
  const found = findOut();
  const path = found ? resolve(dir, `reader-${Date.now()}.html`) : null;
  if (path) { writeFileSync(path, readFileSync(resolve(dir, found))); rmSync(resolve(dir, found)); } // rename so the next export is clean
  await page.close();
  return path;
}

const plan = (reading_font) => ({
  schema: 'inheritance-package/v1',
  package: { title: 'Fonts', reading_font },
  people: [{ id: 'p1', name: 'Anna' }],
  guides: [{ id: 'g0', title: 'Guide', content: { en: 'Read me.' } }] // no audience → no gate
});

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const dir = mkdtempSync(resolve(tmpdir(), 'lp-fonts-'));
const distSize = statSync(DIST).size;

try {
  // Serif pick (Literata): keep UI mono + Literata, drop the other five.
  const litPath = await exportReader(browser, dir, plan('literata'));
  ok('start-here.html produced (literata)', !!litPath);
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
    ok('export is meaningfully smaller than the full app', statSync(litPath).size < distSize - 200_000);
  }

  // Mono guide font: no extra reading face, so only the two UI voices remain.
  const monoPath = await exportReader(browser, dir, plan('mono'));
  if (monoPath) {
    const fams = familiesIn(readFileSync(monoPath, 'utf8'));
    ok('mono plan keeps only the UI voices', fams.size === 2 && fams.has('IBM Plex Mono') && fams.has('IBM Plex Sans'));
    ok('mono export is the smallest', statSync(monoPath).size < statSync(litPath).size);
  }
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Heir export bundles only the chosen font ===');
let fail = 0;
for (const [s, n] of results) { if (s === 'FAIL') fail++; console.log(`  [${s}] ${n}`); }
process.exit(fail ? 1 : 0);
