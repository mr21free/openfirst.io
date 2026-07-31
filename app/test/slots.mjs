// Slots (multi-passphrase container encryption): protect a plan with three
// passphrases via Settings, save it to a file, and cross-check the produced
// container against the published spec by shelling out to the standalone
// recover.js — not just "the app can read its own files." Then remove a
// slot and confirm only that passphrase stops working, and turn protection
// off entirely and confirm the plan goes back to plaintext. Also folds in
// what test/draft-encrypt.mjs used to cover for the old single-passphrase
// scheme: the IndexedDB scratch copy is plaintext when unprotected and
// ciphertext once protected, and resuming a protected draft rejects a wrong
// passphrase before accepting the right one.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const RECOVER = resolve(__dirname, '../recover.js');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const MARK = 'ZZ Secret Marker 4242';

// Must require type="application/json" — see recover.js for why a looser
// match (just the id) would grab this file's own embedded copy of
// recover.js's source instead of the real data island.
const DATA_ISLAND_RE = /<script[^>]*type=["']application\/json["'][^>]*id=["']openfirst-plan-data["'][^>]*>([\s\S]*?)<\/script>/;
const extractContainer = (html) => { const m = DATA_ISLAND_RE.exec(html); return m ? JSON.parse(m[1]) : null; };

function recover(path, passphrase) {
  const args = [RECOVER, path];
  if (passphrase) args.push('--passphrase', passphrase);
  return execFileSync('node', args, { encoding: 'utf8' });
}

const SLOTS = [
  { label: 'For my spouse', hint: 'our anniversary date', pass: 'violet-marmot-canyon-drift-lunar' },
  { label: 'For my lawyer', hint: 'the usual firm password', pass: 'ember-quiet-forest-ridge-comet-nine' },
  { label: 'Backup copy', hint: '', pass: 'harbor-falcon-meadow-brisk-tidal' }
];

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

const dir = mkdtempSync(resolve(tmpdir(), 'lp-slots-'));
// Chrome's CDP-driven downloads overwrite a same-named file in place rather
// than auto-renaming with a "(1)" suffix the way an interactive Save-As
// dialog would — "Download new copy" reuses the plan's stable suggested
// filename every time, so a fresh download can land on a name we've already
// seen. Track mtimes instead of just filenames to catch that case.
const seenMtimes = new Map();
async function waitForNewFile(timeout = 8000) {
  let waited = 0;
  while (waited < timeout) {
    const fresh = readdirSync(dir).filter((f) => f.endsWith('.html')).find((f) => {
      const mtime = statSync(resolve(dir, f)).mtimeMs;
      return !seenMtimes.has(f) || seenMtimes.get(f) !== mtime;
    });
    if (fresh) { seenMtimes.set(fresh, statSync(resolve(dir, fresh)).mtimeMs); return resolve(dir, fresh); }
    await pause(150); waited += 150;
  }
  return null;
}

async function downloadAndRead(page) {
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn button'), { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.filestatus.warn button')?.click());
  const path = await waitForNewFile();
  const html = path ? readFileSync(path, 'utf8') : '';
  return { path, html, container: html ? extractContainer(html) : null };
}

async function addSlot(page, { label, hint, pass }) {
  await page.evaluate(() => [...document.querySelectorAll('.protect button')].find((b) => b.textContent.trim() === '+ Add a passphrase')?.click());
  await page.waitForSelector('.protect .slot-label-input', { timeout: 4000 });
  await page.click('.protect .slot-label-input', { clickCount: 3 });
  await page.type('.protect .slot-label-input', label);
  if (hint) await page.type('.protect .slot-hint-input', hint);
  await page.type('.protect .pw-field .inp', pass);
  await page.waitForSelector('.protect .pw-block > input.inp', { timeout: 3000 });
  await page.type('.protect .pw-block > input.inp', pass);
  await pause(150);
  const before = await page.evaluate(() => document.querySelectorAll('.protect .slot-row').length);
  await page.evaluate(() => [...document.querySelectorAll('.protect button')].find((b) => b.textContent.trim() === 'Add')?.click());
  await page.waitForFunction((n) => document.querySelectorAll('.protect .slot-row').length === n, { timeout: 8000 }, before + 1);
}

async function confirmModal(page, label) {
  await page.waitForFunction(() => !!document.querySelector('.modal-card'), { timeout: 4000 });
  await page.evaluate((l) => [...document.querySelectorAll('.modal-card .modal-actions button')].find((b) => b.textContent.trim() === l)?.click(), label);
  await page.waitForFunction(() => !document.querySelector('.modal-card'), { timeout: 6000 });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create new plan')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === '+ New'), { timeout: 8000 });

  // Add a person — the encrypted-field marker, and the homing trigger.
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', MARK);
  await page.keyboard.press('Escape');
  await page.waitForFunction((m) => document.body.innerText.includes(m), { timeout: 6000 }, MARK);
  await page.waitForFunction(() => !!document.querySelector('.filestatus.warn'), { timeout: 6000 });
  await pause(800);

  const beforeDrafts = await dumpDrafts(page);
  ok('unprotected scratch copy stores the plan in plaintext', beforeDrafts.includes(MARK));

  // --- Settings: add three passphrase slots, one at a time ---
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => /plan protection/i.test(document.body.innerText), { timeout: 5000 });

  for (const s of SLOTS) await addSlot(page, s);
  ok('three passphrase slots show up in Settings', await page.evaluate(() => document.querySelectorAll('.protect .slot-row').length === 3));

  await pause(800);
  const afterDrafts = await dumpDrafts(page);
  ok('protected scratch copy no longer stores plaintext', afterDrafts.length > 0 && !afterDrafts.includes(MARK));
  ok('protected scratch copy is the new slots container shape', afterDrafts.includes('"protection":"passphrase"') && afterDrafts.includes('"slots"'));

  await page.keyboard.press('Escape'); // close Settings

  // --- Save to a file, cross-check against the published spec ---
  const first = await downloadAndRead(page);
  ok('a container-v1 .html was downloaded', !!first.container);
  ok('file reports protection: passphrase', first.container?.protection === 'passphrase');
  ok('file has all three slots', first.container?.slots?.length === 3);
  ok('front door shows the plan title', first.html.includes(`<h1>${first.container.title}</h1>`));
  ok('marker does not leak into the raw file', !first.html.includes(MARK));

  for (const s of SLOTS) {
    const out = recover(first.path, s.pass);
    ok(`recover.js decrypts with "${s.label}"'s passphrase`, out.includes(MARK));
  }

  // --- Remove one slot; only its passphrase should stop working ---
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.protect .slot-row').length === 3, { timeout: 5000 });
  await page.evaluate((label) => {
    const row = [...document.querySelectorAll('.protect .slot-row')].find((r) => r.textContent.includes(label));
    row?.querySelector('.slot-actions button.danger')?.click();
  }, SLOTS[1].label);
  await confirmModal(page, 'Remove');
  await page.waitForFunction(() => document.querySelectorAll('.protect .slot-row').length === 2, { timeout: 6000 });
  ok('removing a slot drops it from the list', true);
  await page.keyboard.press('Escape');

  const second = await downloadAndRead(page);
  ok('re-saved file still reports protection: passphrase', second.container?.protection === 'passphrase');
  ok('re-saved file now has two slots', second.container?.slots?.length === 2);

  let removedStillWorks = true;
  try { recover(second.path, SLOTS[1].pass); } catch { removedStillWorks = false; }
  ok('removed passphrase no longer unlocks the file', !removedStillWorks);
  for (const s of [SLOTS[0], SLOTS[2]]) {
    const out = recover(second.path, s.pass);
    ok(`remaining passphrase "${s.label}" still works`, out.includes(MARK));
  }

  // --- Reload: resume the protected draft, wrong passphrase rejected, right one recovers ---
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Resume'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Resume')?.click());
  await page.waitForSelector('input.pw', { timeout: 6000 });
  ok('resuming a protected plan prompts for a passphrase', true);
  ok('unlock screen lists the two remaining hints', await page.evaluate(() => document.querySelectorAll('.slot-hints li').length === 2));

  await page.type('input.pw', 'totally-wrong-passphrase');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /unlock/i.test(b.textContent))?.click());
  await pause(700);
  ok('wrong passphrase is rejected', await page.evaluate(() => !!document.querySelector('.error-callout') && !!document.querySelector('input.pw')));

  await page.click('input.pw', { clickCount: 3 });
  await page.type('input.pw', SLOTS[0].pass);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /unlock/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /People/.test(b.textContent))?.click());
  await page.waitForFunction((m) => document.body.innerText.includes(m), { timeout: 8000 }, MARK);
  ok('correct remaining passphrase recovers the plan (marker intact)', true);

  // --- Remove the remaining slots one by one: the last removal should turn
  //     protection off entirely (no separate "make passphrase-free" button) ---
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => /plan protection/i.test(document.body.innerText), { timeout: 5000 });

  await page.evaluate(() => document.querySelector('.protect .slot-row .slot-actions button.danger')?.click());
  await confirmModal(page, 'Remove');
  await page.waitForFunction(() => document.querySelectorAll('.protect .slot-row').length === 1, { timeout: 6000 });
  ok('removing the second-to-last slot leaves one behind', true);

  await page.evaluate(() => document.querySelector('.protect .slot-row .slot-actions button.danger')?.click());
  await confirmModal(page, 'Remove');
  await page.waitForFunction(() => !document.querySelector('.protect .slot-row'), { timeout: 6000 });
  ok('removing the last slot turns protection off', true);
  await page.keyboard.press('Escape');

  const third = await downloadAndRead(page);
  ok('final file reports protection: none', third.container?.protection === 'none');
  ok('final file is plaintext (marker visible)', third.html.includes(MARK));

  ok('no runtime errors', errs.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Slots (multi-passphrase container encryption) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
