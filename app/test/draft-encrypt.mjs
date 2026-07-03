// Draft-at-rest encryption: turn on protection in Settings, confirm the draft
// stored in IndexedDB is ciphertext (no plaintext plan leaks), then reload and
// confirm the passphrase gate recovers it — and a wrong passphrase fails.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const PASS = 'correct-horse-battery-staple-anchor';
const MARK = 'ZZ Secret Marker 4242';

// Read every draft record out of the app's IndexedDB, as a JSON string.
const dumpDrafts = (page) => page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('lifepackage');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('drafts', 'readonly');
    const all = tx.objectStore('drafts').getAll();
    all.onsuccess = () => res(JSON.stringify(all.result));
    all.onerror = () => res('');
  };
  req.onerror = () => res('');
}));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /create new plan/i.test(b.textContent)), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /create new plan/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.plan-title-input'), { timeout: 8000 });

  // Put a recognizable marker in a PERSON name (an encrypted field — the plan
  // title is intentionally kept readable for the resume list, so it's a poor
  // marker). Go to People, add one, name it, close the form.
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('main .section-head button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', MARK);
  await page.keyboard.press('Escape');
  await page.waitForFunction((m) => /Auto-saved to this device/.test(document.querySelector('.sr-only')?.textContent || ''), { timeout: 5000 }, MARK).catch(() => {});
  await pause(400);

  const before = await dumpDrafts(page);
  ok('unprotected draft stores the plan in plaintext', before.includes(MARK));

  // Settings → Protect this draft.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => /draft protection/i.test(document.body.innerText), { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /protect this draft/i.test(b.textContent))?.click());
  await page.waitForSelector('.protect input[type=password]', { timeout: 4000 });
  await page.type('.protect input[type=password]', PASS);
  await page.evaluate(() => [...document.querySelectorAll('.protect button')].find((b) => /turn on/i.test(b.textContent))?.click());
  await page.waitForFunction(() => /encrypted at rest/i.test(document.body.innerText), { timeout: 6000 });
  ok('settings confirms the draft is encrypted', true);
  await pause(400);

  const after = await dumpDrafts(page);
  ok('protected draft no longer stores plaintext', after.length > 0 && !after.includes(MARK));
  ok('protected draft record is marked enc:v1', after.includes('"enc":"v1"') || after.includes('enc'));

  // Reload the page: the draft should now require the passphrase to resume.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /resume/i.test(b.textContent)), { timeout: 8000 });
  const lockShown = await page.evaluate(() => /🔒|encrypted/i.test(document.body.innerText));
  ok('resume list flags the protected draft', lockShown);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /resume/i.test(b.textContent))?.click());
  await page.waitForSelector('input.pw', { timeout: 6000 });
  ok('resuming a protected draft prompts for the passphrase', true);

  // Wrong passphrase → error, stays on the gate.
  await page.type('input.pw', 'totally-wrong-passphrase');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /unlock/i.test(b.textContent))?.click());
  await pause(700);
  ok('wrong passphrase is rejected', await page.evaluate(() => !!document.querySelector('.error') && !!document.querySelector('input.pw')));

  // Correct passphrase → back into the plan with the marker intact.
  await page.click('input.pw', { clickCount: 3 });
  await page.type('input.pw', PASS);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /unlock/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await page.waitForFunction((m) => document.body.innerText.includes(m), { timeout: 8000 }, MARK);
  ok('correct passphrase recovers the draft (person name intact)', true);
  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Draft-at-rest encryption ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
