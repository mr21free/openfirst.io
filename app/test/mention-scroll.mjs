// The "@" mention autocomplete shows a scrollable list. Arrowing down past the
// visible rows must scroll the list so the highlighted option stays in view
// (you couldn't reach options 5+ by keyboard before).
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
  package: { title: 'Mention scroll', primary_person_ids: ['p1'] },
  people: [{ id: 'p1', name: 'Reader' }],
  items: Array.from({ length: 12 }, (_, i) => ({ id: 'i' + i, name: `Trezor device ${String(i + 1).padStart(2, '0')}` })),
  guides: [{ id: 'g1', title: 'Notes', audience_person_ids: ['p1'], content: { en: '' } }]
};
const dir = mkdtempSync(resolve(tmpdir(), 'lp-ment-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

const activeInfo = () => page.evaluate(() => {
  const list = document.querySelector('.mentionpop .reflist');
  const on = document.querySelector('.mentionpop .refrow.on');
  if (!list || !on) return null;
  const lr = list.getBoundingClientRect(); const or = on.getBoundingClientRect();
  return { scrollTop: list.scrollTop, visible: or.top >= lr.top - 1 && or.bottom <= lr.bottom + 1, label: on.textContent.replace(/\s+/g, ' ').trim() };
});

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('nav .navguide-input')].find((i) => i.value === 'Notes')?.click());
  await page.waitForFunction(() => !!document.querySelector('.ce-edit'), { timeout: 6000 });
  await pause();

  // Type "@trezor" to open the mention list (12 matching items).
  await page.focus('.ce-edit');
  await page.keyboard.type('@trezor');
  await page.waitForFunction(() => document.querySelectorAll('.mentionpop .refrow').length > 5, { timeout: 5000 });
  ok('the mention list holds more rows than fit (overflows)', await page.evaluate(() => {
    const l = document.querySelector('.mentionpop .reflist');
    return l.scrollHeight > l.clientHeight + 5;
  }));

  const before = await activeInfo();
  // Arrow down well past the visible rows.
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowDown'); await pause(40); }
  const after = await activeInfo();

  ok('arrowing down scrolled the list', after && after.scrollTop > (before?.scrollTop || 0));
  ok('the highlighted option stays visible after scrolling', after && after.visible);
  ok('the highlight actually advanced down the list', after && /0[89]|1[012]/.test(after.label));
  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== @mention list scrolls with the keyboard ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
