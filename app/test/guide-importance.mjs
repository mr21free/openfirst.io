// In READ mode, a cross-link to an entity that carries an importance level shows
// that level inline as "[Importance: high]" right after the link. Links come
// only from explicit [[id]] references (plain text never auto-links). People
// have no importance, so their links stay unmarked. The marker is a sibling of
// the link (metadata), never inside the clickable anchor.
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

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Importance test' },
  people: [{ id: 'p1', name: 'Reader' }, { id: 'p2', name: 'Bob Helper' }],
  items: [
    { id: 'i1', name: 'Home safe', importance: 'high' },
    { id: 'i2', name: 'Old laptop', importance: 'low' },
    { id: 'i3', name: 'Spare phone' } // no importance set
  ],
  guides: [{
    id: 'g1', title: 'Steps', audience_person_ids: ['p1'],
    // i1: explicit (high) · i2: explicit (low) · plain "Home safe" must NOT link · p2: person (none) · i3: explicit, no importance
    content: { en: 'Open the [[i1]] first.\nThen check the [[i2]] carefully.\nThe Home safe lives in the office.\nAsk [[p2]] if stuck, and grab the [[i3]].' },
    references: { item_ids: ['i1', 'i2', 'i3'], person_ids: ['p2'] }
  }]
};

const dir = mkdtempSync(resolve(tmpdir(), 'lp-imp-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

// Marker right after a link a[data-id=ID]? Returns its text, or null.
const markerFor = (id) => page.evaluate((id) => {
  const a = document.querySelector(`main .prose a.xref[data-id="${id}"]`);
  if (!a) return '__no-link__';
  let n = a.nextSibling;
  if (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling; // skip the spacing text node
  return (n && n.classList && n.classList.contains('xref-imp')) ? n.textContent : null;
}, id);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('main .prose a.xref'), { timeout: 8000 });
  await pause();

  ok('explicit [[ref]] to a HIGH item shows [Importance: high]', (await markerFor('i1')) === '[Importance: high]');
  ok('explicit [[ref]] to a LOW item shows [Importance: low]', (await markerFor('i2')) === '[Importance: low]');
  ok('a person reference shows no importance marker', (await markerFor('p2')) === null);
  ok('an item without importance shows no marker', (await markerFor('i3')) === null);

  // The marker is a sibling, not inside the anchor (so it isn't part of the link).
  ok('marker sits outside the clickable link', await page.evaluate(() => !document.querySelector('main .prose a.xref .xref-imp')));
  // A plain-text mention of an item's name must NOT auto-link — so i1 links exactly
  // once (its explicit [[i1]]), proving "Home safe" in prose stayed plain text.
  ok('plain mention of an entity name does not auto-link', await page.evaluate(() =>
    document.querySelectorAll('main .prose a.xref[data-id="i1"]').length === 1));
  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Importance shown next to cross-links ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
