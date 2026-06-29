// Regression test for guide-nav drag & drop reordering.
//
// Repro for two reported bugs:
//   1. A guide could not be moved to be the FIRST item at the top level
//      (above a group) — it always snapped back behind the group.
//   2. A guide already at the top level could not be reordered at all
//      (only group → root moves worked).
//
// Both came from store.moveGuide() renumbering from half-written orders,
// which tied a root guide with a group and let the group win the tiebreak.
//
// We drive the real built app via "Create new plan", which seeds exactly the
// failing shape: a "General" group containing a "Start here" guide.

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
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (b) { b.click(); return true; } return false; }, t);

// Read the guide nav as an ordered list of "guide:<title>" / "group:<name>[g1,g2]".
const navOrder = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('nav > *')) {
    if (el.classList.contains('navrow')) {
      out.push('guide:' + (el.querySelector('input')?.value ?? el.textContent.trim()));
    } else if (el.classList.contains('navgroup')) {
      const name = el.querySelector('.navgroup-title input')?.value ?? el.querySelector('.navgroup-title')?.textContent.trim();
      const guides = [...el.querySelectorAll('.navrow')].map((r) => r.querySelector('input')?.value ?? r.textContent.trim());
      out.push('group:' + name + '[' + guides.join(',') + ']');
    }
  }
  return out;
});

const waitNav = (expected) => page.waitForFunction((exp) => {
  const out = [];
  for (const el of document.querySelectorAll('nav > *')) {
    if (el.classList.contains('navrow')) {
      out.push('guide:' + (el.querySelector('input')?.value ?? el.textContent.trim()));
    } else if (el.classList.contains('navgroup')) {
      const name = el.querySelector('.navgroup-title input')?.value ?? el.querySelector('.navgroup-title')?.textContent.trim();
      const guides = [...el.querySelectorAll('.navrow')].map((r) => r.querySelector('input')?.value ?? r.textContent.trim());
      out.push('group:' + name + '[' + guides.join(',') + ']');
    }
  }
  return JSON.stringify(out) === exp;
}, { timeout: 4000 }, JSON.stringify(expected)).then(() => true).catch(() => false);

// Begin a drag on a root-level guide (from its grip handle, like a real user).
const dragStartRootGuide = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('nav > .navrow')].find((r) => (r.querySelector('input')?.value ?? '') === name);
  if (!row) return false;
  (row.querySelector('.navguide-grip') || row).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
  return true;
}, name);

// Begin a drag on a guide nested inside a group (from its grip handle).
const dragStartGroupedGuide = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('nav .navgroup .navrow')].find((r) => (r.querySelector('input')?.value ?? '') === name);
  if (!row) return false;
  (row.querySelector('.navguide-grip') || row).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
  return true;
}, name);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await clickText('Create new plan');

  // New plans drop straight into edit mode with General → Start here.
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New guide'), { timeout: 8000 });
  ok('new plan seeds [General[Start here]]', JSON.stringify(await navOrder()) === JSON.stringify(['group:General[Start here]']));

  // Add a guide → lands at the top level, after the group.
  await clickText('+ New guide');
  ok('added guide sits at top level after the group', await waitNav(['group:General[Start here]', 'guide:New Guide']));

  // ---- Bug 1: move the top-level guide ABOVE the group (becomes first) ----
  await dragStartRootGuide('New Guide');
  // The "before group" drop strip only renders during a guide drag.
  await page.waitForFunction(() => !!document.querySelector('nav .before-group-zone'), { timeout: 2000 });
  await page.evaluate(() => {
    const zone = [...document.querySelectorAll('nav .before-group-zone')].find((z) => {
      const g = z.nextElementSibling;
      if (!g || !g.classList.contains('navgroup')) return false;
      const name = g.querySelector('.navgroup-title input')?.value ?? g.querySelector('.navgroup-title')?.textContent.trim();
      return name === 'General';
    });
    const dt = new DataTransfer();
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  ok('Bug 1: guide moves to FIRST at top level (above the group)', await waitNav(['guide:New Guide', 'group:General[Start here]']));

  // ---- Bug 2: reorder a top-level guide (one below the group, up to the top) ----
  await clickText('+ New guide'); // → "New Guide (1)" appended at the top level
  ok('second top-level guide appended', await waitNav(['guide:New Guide', 'group:General[Start here]', 'guide:New Guide (1)']));

  await dragStartRootGuide('New Guide (1)');
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('nav > .navrow')].find((r) => (r.querySelector('input')?.value ?? '') === 'New Guide');
    const r = target.getBoundingClientRect();
    const dt = new DataTransfer();
    const opts = { bubbles: true, dataTransfer: dt, clientY: r.top + 2 }; // top half → drop BEFORE
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  });
  ok('Bug 2: a top-level guide can be reordered (and moved up past the group)', await waitNav(['guide:New Guide (1)', 'guide:New Guide', 'group:General[Start here]']));

  // ---- A top-level guide can be dropped INTO a group ----
  await dragStartRootGuide('New Guide');
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('nav .navgroup')].find((n) => (n.querySelector('.navgroup-title input')?.value ?? n.querySelector('.navgroup-title')?.textContent.trim()) === 'General');
    const dt = new DataTransfer();
    grp.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    grp.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  ok('a top-level guide drops into a group', await waitNav(['guide:New Guide (1)', 'group:General[New Guide,Start here]']));

  // ---- A grouped guide can be lifted back out to the top level (drop past the last root guide) ----
  await dragStartGroupedGuide('New Guide');
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('nav > .navrow')].find((r) => (r.querySelector('input')?.value ?? '') === 'New Guide (1)');
    const r = target.getBoundingClientRect();
    const dt = new DataTransfer();
    const opts = { bubbles: true, dataTransfer: dt, clientY: r.bottom - 2 }; // bottom half → after, lands at top level
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  });
  ok('a grouped guide lifts back out to the top level', await waitNav(['guide:New Guide (1)', 'group:General[Start here]', 'guide:New Guide']));

  // ---- Multi-group: lift a group's ONLY guide out via its own "before" zone ----
  // (Regression: with 2+ groups this used to dump the guide at the very end
  // instead of landing it at the top level just before that group.)
  await clickText('+ New group'); // → empty "New group" at the end
  await waitNav(['guide:New Guide (1)', 'group:General[Start here]', 'guide:New Guide', 'group:New group[]']);
  await dragStartRootGuide('New Guide');
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('nav .navgroup')].find((n) => (n.querySelector('.navgroup-title input')?.value ?? n.querySelector('.navgroup-title')?.textContent.trim()) === 'New group');
    const dt = new DataTransfer();
    grp.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    grp.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await waitNav(['guide:New Guide (1)', 'group:General[Start here]', 'group:New group[New Guide]']);

  await dragStartGroupedGuide('New Guide'); // its sole guide
  await page.waitForFunction(() => !!document.querySelector('nav .before-group-zone'), { timeout: 2000 });
  await page.evaluate(() => {
    const zone = [...document.querySelectorAll('nav .before-group-zone')].find((z) => {
      const g = z.nextElementSibling;
      return g && g.classList.contains('navgroup') && ((g.querySelector('.navgroup-title input')?.value ?? g.querySelector('.navgroup-title')?.textContent.trim()) === 'New group');
    });
    const dt = new DataTransfer();
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  ok("multi-group: a group's only guide lifts out to just before that group", await waitNav(['guide:New Guide (1)', 'group:General[Start here]', 'guide:New Guide', 'group:New group[]']));

  // ---- Drop a guide after a trailing group-with-children (the end zone) ----
  // (Regression: a guide could not land after a group that is the last block.)
  await dragStartRootGuide('New Guide'); // fill the trailing "New group" so it has a child
  await page.evaluate(() => {
    const grp = [...document.querySelectorAll('nav .navgroup')].find((n) => (n.querySelector('.navgroup-title input')?.value ?? '') === 'New group');
    const dt = new DataTransfer();
    grp.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    grp.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await waitNav(['guide:New Guide (1)', 'group:General[Start here]', 'group:New group[New Guide]']);

  await dragStartRootGuide('New Guide (1)');
  await page.evaluate(() => {
    const z = document.querySelector('nav .end-zone');
    const dt = new DataTransfer();
    z.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    z.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  ok('a guide drops to the end, past a trailing group', await waitNav(['group:General[Start here]', 'group:New group[New Guide]', 'guide:New Guide (1)']));

  ok('no runtime errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Guide nav drag & drop ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
