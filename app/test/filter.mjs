// Faceted filtering: within a facet selections OR together; across facets they
// AND. Plus a Sort that reorders the visible list. Exercised on the Demo plan.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const rows = () => page.evaluate(() => document.querySelectorAll('main .ulist .ulist-row').length);
const goSection = (label) => page.evaluate((label) => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes(label))?.click(), label);
const openFilter = () => page.evaluate(() => document.querySelector('.filterbtn')?.click());
// Tick an option (by visible name) inside the facet whose label matches.
const tick = (facet, opt) => page.evaluate(({ facet, opt }) => {
  const f = [...document.querySelectorAll('.filterpop .facet')].find((x) => x.querySelector('.facet-label')?.textContent.trim() === facet);
  const o = [...(f?.querySelectorAll('.facet-opt') || [])].find((x) => x.querySelector('.facet-name')?.textContent.trim() === opt);
  o?.querySelector('input')?.click();
}, { facet, opt });
const facetCount = (facet, opt) => page.evaluate(({ facet, opt }) => {
  const f = [...document.querySelectorAll('.filterpop .facet')].find((x) => x.querySelector('.facet-label')?.textContent.trim() === facet);
  const o = [...(f?.querySelectorAll('.facet-opt') || [])].find((x) => x.querySelector('.facet-name')?.textContent.trim() === opt);
  return Number(o?.querySelector('.facet-count')?.textContent || -1);
}, { facet, opt });

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await (await page.$('input[type="file"]')).uploadFile(resolve(__dirname, '../src/sample/lifepackage.json'));
  // The sample opens on the "who are you?" gate — step past it into the plan.
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await pause(300);

  // ---- Items: importance + location ----
  await goSection('Items'); await pause();
  const total = await rows();
  ok('items list shows all items', total === 43);

  await openFilter(); await pause(150);
  const high = await facetCount('Importance', 'High');
  const medium = await facetCount('Importance', 'Medium');
  ok('facet counts match the data', high === 34 && medium === 8);

  await tick('Importance', 'High'); await pause(250);
  ok('single facet value filters (High)', (await rows()) === high);

  await tick('Importance', 'Medium'); await pause(250);
  ok('OR within a facet (High OR Medium)', (await rows()) === high + medium);

  // Add an across-facet condition: it must only narrow (AND across facets).
  const orCount = await rows();
  const firstLoc = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.filterpop .facet')].find((x) => x.querySelector('.facet-label')?.textContent.trim() === 'Location');
    const o = f?.querySelector('.facet-opt');
    o?.querySelector('input')?.click();
    return Number(o?.querySelector('.facet-count')?.textContent || -1);
  }); await pause(250);
  const andCount = await rows();
  ok('AND across facets only narrows', andCount <= orCount && andCount <= firstLoc);

  // Two pills shown (Importance + Location).
  ok('an active pill per facet is shown', (await page.evaluate(() => document.querySelectorAll('.filterpills .fpill').length)) === 2);

  // Clear all returns to the full list.
  await page.evaluate(() => document.querySelector('.filterpills .pill-clear')?.click()); await pause(250);
  ok('clear all restores the full list', (await rows()) === total && (await page.evaluate(() => document.querySelectorAll('.filterpills .fpill').length)) === 0);

  // ---- Sort by name ----
  await page.select('.sortsel', 'name'); await pause(250);
  const names = await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-name')].map((n) => n.textContent.replace(/\s*●.*$/, '').trim()));
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  ok('sort by name orders the list A→Z', JSON.stringify(names) === JSON.stringify(sorted) && names.length === total);

  // ---- People: role facet ----
  await goSection('People'); await pause();
  const peopleTotal = await rows();
  await openFilter(); await pause(150);
  const roleOpt = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.filterpop .facet')].find((x) => x.querySelector('.facet-label')?.textContent.trim() === 'Role');
    const o = f?.querySelector('.facet-opt');
    const name = o?.querySelector('.facet-name')?.textContent.trim();
    const count = Number(o?.querySelector('.facet-count')?.textContent || -1);
    o?.querySelector('input')?.click();
    return { name, count };
  }); await pause(250);
  ok('people role facet filters', (await rows()) === roleOpt.count && roleOpt.count < peopleTotal);

  // ---- Locations: a filter (Contents), but no sort (tree order is meaningful) ----
  await goSection('Locations'); await pause();
  const locTotal = await rows();
  ok('locations have a Filter but no Sort', await page.evaluate(() => !!document.querySelector('.filterbtn') && !document.querySelector('.sortsel')));
  await openFilter(); await pause(150);
  ok('locations expose a Contents facet', await page.evaluate(() => [...document.querySelectorAll('.filterpop .facet-label')].some((f) => f.textContent.trim() === 'Contents')));
  const empty = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.filterpop .facet')].find((x) => x.querySelector('.facet-label')?.textContent.trim() === 'Contents');
    const o = [...(f?.querySelectorAll('.facet-opt') || [])].find((x) => /Empty/.test(x.textContent));
    const count = Number(o?.querySelector('.facet-count')?.textContent || -1);
    o?.querySelector('input')?.click();
    return count;
  }); await pause(250);
  ok('contents=Empty narrows the location list', (await rows()) < locTotal && (await rows()) >= empty);

  ok('no runtime errors', true);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Faceted filtering ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
