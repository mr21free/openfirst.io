// Type icons read the same everywhere. The left nav puts a leading icon on the
// object sections (Map, People, Roles, Locations, Items, Files) but NOT on
// guides; the Map sits apart with its own icon. Draft guides show their marker
// to the LEFT of the title. In the side panel, every referenced row (a file, a
// location, a person…) carries a leading icon matching its type.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Signatures from src/lib/icons.js — enough to prove the RIGHT glyph rendered.
const SIG = {
  location: 'M21 10c0 7-9 13-9 13',
  person: 'M20 21v-2a4 4',
  people: 'M17 21v-2a4 4',
  item: 'M21 16V8a2 2',
  file: 'M13 2H6a2 2',
  map: '1 6 1 22 8 18'
};

const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Nav icons' },
  people: [{ id: 'p1', name: 'Anna' }, { id: 'p2', name: 'Ben' }],
  locations: [
    { id: 'l1', name: 'Slovakia' },
    { id: 'l2', name: 'Office safe', parent_id: 'l1' }
  ],
  items: [{
    id: 'i1', name: 'Bank account', importance: 'high',
    location_ids: ['l2'], access_person_ids: ['p1', 'p2'], attachment_ids: ['a_pdf']
  }],
  attachments: [{ id: 'a_pdf', filename: 'testament.pdf', mime: 'application/pdf', path: 'docs/t.pdf', item_ids: ['i1'] }],
  guide_groups: [{ id: 'gg1', name: 'Money' }],
  guides: [
    { id: 'g1', title: 'Welcome', group: 'gg1', content: { en: 'Hi.' } },
    { id: 'g2', title: 'Draft note', group: 'gg1', draft: true, content: { en: 'WIP.' } }
  ]
};

const dir = mkdtempSync(resolve(tmpdir(), 'lp-navico-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 940 });

// All path/polygon vertex data inside the first .ulist-ico of the field whose
// uppercase label matches `label`.
const fieldIconGeom = (label) => page.evaluate((label) => {
  const field = [...document.querySelectorAll('.drawer .field')]
    .find((f) => (f.querySelector('.muted')?.textContent || '').trim().toLowerCase() === label.toLowerCase());
  if (!field) return '__no-field__';
  const svg = field.querySelector('.ulist-ico svg');
  if (!svg) return '__no-icon__';
  return [...svg.children].map((c) => c.getAttribute('d') || c.getAttribute('points') || '').join(' ');
}, label);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await pause();

  // --- nav: sections get icons, guides do not ---
  const sectionGeom = (label) => page.evaluate((label) => {
    const btn = [...document.querySelectorAll('nav .navlink-section')]
      .find((b) => (b.querySelector('.navlabel')?.textContent || '').trim() === label);
    const svg = btn?.querySelector('.navico svg');
    return svg ? [...svg.children].map((c) => c.getAttribute('d') || c.getAttribute('points') || '').join(' ') : null;
  }, label);

  ok('People section shows the people icon', (await sectionGeom('People'))?.includes(SIG.people));
  ok('Locations section shows the location icon', (await sectionGeom('Locations'))?.includes(SIG.location));
  ok('Items section shows the item icon', (await sectionGeom('Items'))?.includes(SIG.item));
  ok('Files section shows the file icon', (await sectionGeom('Files'))?.includes(SIG.file));
  ok('Map shows the map icon and sits in its own row', await page.evaluate((sig) => {
    const m = [...document.querySelectorAll('nav .navlink-section')].find((b) => /^Map$/.test(b.querySelector('.navlabel')?.textContent || ''));
    return !!m && m.classList.contains('navlink-map') && (m.querySelector('.navico svg polygon')?.getAttribute('points') || '').includes(sig);
  }, SIG.map));
  ok('guide nav rows carry no section icon', await page.evaluate(() =>
    [...document.querySelectorAll('nav .navrow')].every((r) => !r.querySelector('.navico'))));

  // --- draft marker sits to the LEFT of the guide title ---
  ok('draft marker comes before the guide title in its row', await page.evaluate(() => {
    const row = [...document.querySelectorAll('nav .navrow.is-draft')][0];
    if (!row) return false;
    const mark = row.querySelector('.draft-mark');
    const title = row.querySelector('.navlink, .navguide-input');
    if (!mark || !title) return false;
    // DOCUMENT_POSITION_FOLLOWING (4) => title comes after the mark.
    return !!(mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));

  // --- side panel: each referenced row has a leading type icon of its kind ---
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /^Items$/.test(b.querySelector('.navlabel')?.textContent || ''))?.click());
  await pause();
  await page.evaluate(() => [...document.querySelectorAll('.ulist-name')].find((n) => /Bank account/.test(n.textContent))?.closest('button')?.click());
  await page.waitForFunction(() => !!document.querySelector('.drawer .field .ulist-ico svg'), { timeout: 8000 });
  await pause();

  ok('“Where it is” row shows the location icon', (await fieldIconGeom('Where it is'))?.includes?.(SIG.location));
  ok('“Who can access” row shows a person icon', (await fieldIconGeom('Who can access'))?.includes?.(SIG.person));
  ok('attachment (PDF) row shows the file icon', (await fieldIconGeom('Attachments'))?.includes?.(SIG.file));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Type icons: nav sections, iconless guides, side-panel rows ===');
let fail = 0;
for (const [s, n] of results) { if (s === 'FAIL') fail++; console.log(`  [${s}] ${n}`); }
process.exit(fail ? 1 : 0);
