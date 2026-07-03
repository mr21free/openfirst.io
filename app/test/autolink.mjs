// Cross-links come ONLY from explicit [[id]] references the author inserted.
// Plain prose that merely matches an entity's name — even in a bold label or a
// heading — must NOT become a link. (Typing a name is not making a reference.)
//
// Fixture: guide "g2" references guide "g1" (titled "Investments and bank
// accounts") and writes that exact name three ways:
//   1) inside **bold**           -> must NOT link
//   2) in a plain sentence       -> must NOT link
//   3) as an explicit [[g1]]     -> links (the only one)
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

const NAME = 'Investments and bank accounts';
const fixture = {
  schema: 'inheritance-package/v1',
  package: { title: 'Explicit-only links' },
  people: [{ id: 'p1', name: 'Reader' }],
  guides: [
    { id: 'g1', title: NAME, content: { en: 'Body of the investments guide.' } },
    {
      id: 'g2', title: 'Other notes', audience_person_ids: ['p1'],
      content: { en: `**Other ${NAME}**\nKeep your ${NAME} up to date.\nFollow instructions in [[g1]]` },
      references: { guide_ids: ['g1'] }
    }
  ]
};

const dir = mkdtempSync(resolve(tmpdir(), 'lp-autolink-'));
const fpath = resolve(dir, 'plan.json');
writeFileSync(fpath, JSON.stringify(fixture));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1280, height: 900 });

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);

  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink'), { timeout: 8000 });

  await page.evaluate(() => [...document.querySelectorAll('nav .navlink')].find((b) => /Other notes/.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('main .prose strong'), { timeout: 6000 });
  await pause();

  const r = await page.evaluate(() => {
    const prose = document.querySelector('main .prose');
    const g1 = [...prose.querySelectorAll('a.xref')].filter((a) => a.dataset.id === 'g1');
    return {
      total: prose.querySelectorAll('a.xref').length,
      g1Count: g1.length,
      g1Text: g1[0]?.textContent || '',
      boldText: prose.querySelector('strong')?.textContent || '',
      boldHasLink: !!prose.querySelector('strong a.xref')
    };
  });

  ok('bold label repeats the entity name', /Investments and bank accounts/.test(r.boldText));
  ok('bold label is not linked', r.boldHasLink === false);
  ok('only the explicit [[ref]] links (exactly one, nothing auto-linked)', r.g1Count === 1 && r.total === 1);
  ok('the explicit reference renders the entity name', /Investments and bank accounts/.test(r.g1Text));
  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Only explicit references link (no auto-linking) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
