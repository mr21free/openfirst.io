// Importing a plan JSON (the BYO-AI flow): the documented minimal example must
// import cleanly, and a plan with broken references must be rejected with
// actionable messages.

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

// The same minimal example printed in docs/ai-builder-prompt.md.
const example = {
  schema: 'inheritance-package/v1',
  package: { id: 'plan-1', title: 'My inheritance plan', owner_id: 'person_me', created: '2026-01-01', updated: '2026-01-01', languages: ['en'], default_language: 'en' },
  roles: [{ id: 'owner', name: 'Owner' }, { id: 'primary_heir', name: 'Primary heir' }],
  people: [{ id: 'person_me', name: 'Me', roles: ['owner'] }, { id: 'person_spouse', name: 'Jane', roles: ['primary_heir'] }],
  locations: [{ id: 'loc_country', name: 'Country X', order: 0 }, { id: 'loc_home', name: 'Home safe', parent_id: 'loc_country', order: 0 }],
  items: [{ id: 'item_will', name: 'Will (original)', importance: 'high', location_ids: ['loc_home'], access_person_ids: ['person_spouse'] }],
  guide_groups: [{ id: 'general', name: 'General', order: 0 }],
  guides: [{ id: 'guide_first', title: 'First steps', group: 'general', order: 0, audience_roles: ['primary_heir'], content: { en: '## First steps\n\nThe will is at [[loc_home]]; [[person_spouse]] can open it.' }, references: { location_ids: ['loc_home'], person_ids: ['person_spouse'] } }],
  attachments: []
};
const broken = { schema: 'inheritance-package/v1', package: { id: 'p', title: 't', owner_id: 'ghost', languages: ['en'], default_language: 'en' }, people: [{ id: 'a', name: 'A' }], items: [{ id: 'i', name: 'X', location_ids: ['loc_nope'] }] };

const dir = mkdtempSync(resolve(tmpdir(), 'lp-imp-'));
writeFileSync(resolve(dir, 'plan.json'), JSON.stringify(example));
writeFileSync(resolve(dir, 'broken.json'), JSON.stringify(broken));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const pause = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const upload = async (f) => { const i = await page.$('input[type=file]:not([webkitdirectory])'); await i.uploadFile(resolve(dir, f)); await pause(700); };
const fresh = async () => { await page.goto(FILE, { waitUntil: 'load' }); await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 }); };

try {
  await fresh();
  await upload('plan.json');
  ok('documented example imports into the reader', await page.evaluate(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav')));

  await fresh();
  await upload('broken.json');
  const err = await page.evaluate(() => document.querySelector('.error')?.textContent || '');
  ok('broken plan is rejected with the bad owner_id', /owner_id.*not a known person/i.test(err));
  ok('broken plan flags the dangling location reference', /missing location/i.test(err));
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }

console.log('\n=== Import + validation ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
process.exit(failed ? 1 : 0);
