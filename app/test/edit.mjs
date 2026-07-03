import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('dialog', (d) => d.accept()); // auto-accept delete confirm
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const clickText = (t) => page.evaluate((t) => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes(t)); if(b){b.click();return true;} return false; }, t);

try {
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo'), { timeout: 8000 });
  await clickText('Demo');
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await clickText('Admin');
  await page.waitForFunction(() => !!document.querySelector('.plan-edit'), { timeout: 8000 });

  ok('idb available on file://', await page.evaluate(() => !!window.indexedDB));

  await page.keyboard.down('Meta');
  await page.keyboard.press('KeyE');
  await page.keyboard.up('Meta');
  await page.waitForFunction(() => !!document.querySelector('nav .navadd'), { timeout: 6000 });
  ok('keyboard shortcut enters edit mode', true);

  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('People'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'People' && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '+ New'), { timeout: 6000 });
  const before = await page.$$eval('main .ulist-row', (r) => r.length);

  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  ok('add person opens the edit form', true);

  await page.click('[role="dialog"] .frm input', { clickCount: 3 });
  await page.type('[role="dialog"] .frm input', 'ZZ Test Person');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Test Person'), { timeout: 6000 });
  const after = await page.$$eval('main .ulist-row', (r) => r.length);
  ok('new person added + name edits live', after === before + 1);

  // autosave persisted? (the save state is announced via an off-screen aria-live
  // region, kept for assistive tech even though it isn't shown on screen)
  const saved = await page.waitForFunction(() => /Auto-saved to this device/.test(document.querySelector('.sr-only')?.textContent || ''), { timeout: 4000 }).then(() => true).catch(() => false);
  ok('change auto-saved to device', saved);

  // delete the new person (last row's ✕)
  await page.evaluate(() => { const rows=[...document.querySelectorAll('main .ulist-row')]; const row=rows.find(r=>r.textContent.includes('ZZ Test Person')); row?.querySelector('.rowdel')?.click(); });
  await page.waitForFunction(() => !!document.querySelector('[role="alertdialog"]'), { timeout: 4000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Delete')?.click());
  await page.waitForFunction(() => !document.body.innerText.includes('ZZ Test Person'), { timeout: 6000 });
  const afterDel = await page.$$eval('main .ulist-row', (r) => r.length);
  ok('delete person removes the row', afterDel === before);

  const setFirstInput = async (val) => { await page.click('[role="dialog"] .frm input', { clickCount: 3 }); await page.type('[role="dialog"] .frm input', val); };

  // --- Items: add + edit + relationship picker ---
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => b.textContent.includes('Items'))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Items', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await setFirstInput('ZZ Test Item');
  // add a location to the item via the relationship picker
  await page.evaluate(() => { const sel = document.querySelector('[role="dialog"] .picker select'); if (sel) { const o = [...sel.options].find((x) => x.value); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } } });
  const chip = await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .pchip'), { timeout: 4000 }).then(() => true).catch(() => false);
  ok('item form + relationship picker adds a reference', chip);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Test Item'), { timeout: 6000 });
  ok('add item + name edits live', true);

  // --- Locations: add top-level + add child (nesting) ---
  await clickText('Locations');
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Locations', { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll('main .section-head button')].find((b) => b.textContent.trim() === '+ New')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await setFirstInput('ZZ Test Country');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Test Country'), { timeout: 6000 });
  // add a child inside it
  await page.evaluate(() => { const row = [...document.querySelectorAll('main .ulist-row')].find((r) => r.textContent.includes('ZZ Test Country')); row?.querySelector('.rowadd')?.click(); });
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  await setFirstInput('ZZ Test City');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.innerText.includes('ZZ Test City'), { timeout: 6000 });
  const nested = await page.evaluate(() => { const row = [...document.querySelectorAll('main .ulist-row')].find((r) => r.textContent.includes('ZZ Test City')); return !!row && row.classList.contains('nested'); });
  ok('location nesting (add child) works', nested);

  // drag the nested city up onto the country's top edge → becomes a top-level sibling
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('main .loc-row')];
    const city = rows.find((r) => r.textContent.includes('ZZ Test City'));
    const country = rows.find((r) => r.textContent.includes('ZZ Test Country'));
    if (!city || !country) return;
    const dt = new DataTransfer();
    const cr = country.getBoundingClientRect();
    city.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    country.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: cr.top + 1 }));
    country.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: cr.top + 1 }));
    city.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });
  const unnested = await page.waitForFunction(() => { const row = [...document.querySelectorAll('main .loc-row')].find((r) => r.textContent.includes('ZZ Test City')); return !!row && !row.classList.contains('nested'); }, { timeout: 4000 }).then(() => true).catch(() => false);
  ok('drag a location to reorder / unnest (DnD)', unnested);

  // --- Guides: add via nav → opens the inline WYSIWYG editor on the guide page ---
  await clickText('+ New guide');
  await page.waitForFunction(() => !!document.querySelector('main .ce .ce-edit'), { timeout: 6000 });
  ok('add guide opens the inline WYSIWYG editor on the page', await page.evaluate(() => !!document.querySelector('main .ce .tb-ref') && !!document.querySelector('main .ce .ce-edit')));
  // a brand-new (empty) guide, viewed in read mode, shows the empty-state CTA
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyE'); await page.keyboard.up('Meta');
  await page.waitForFunction(() => !!document.querySelector('.guide-empty'), { timeout: 6000 });
  ok('empty guide shows a "Start writing" empty state in read mode', await page.evaluate(() => [...document.querySelectorAll('.guide-empty button')].some((b) => /start writing/i.test(b.textContent))));
  await page.evaluate(() => [...document.querySelectorAll('.guide-empty button')].find((b) => /start writing/i.test(b.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('main .ce .ce-edit') && !document.querySelector('.guide-empty'), { timeout: 6000 });
  ok('"Start writing" returns to the editor', true);
  // reference insertion as an atomic pill (Contentful-style): search → pick → drops a non-editable chip + registers the link
  await page.evaluate(() => document.querySelector('main .ce .tb-ref')?.click());
  await page.waitForFunction(() => !!document.querySelector('main .ce .refrow'), { timeout: 4000 });
  await page.evaluate(() => document.querySelector('main .ce .refrow')?.click());
  const inserted = await page.waitForFunction(() => !!document.querySelector('main .ce .ce-edit .refchip'), { timeout: 4000 }).then(() => true).catch(() => false);
  ok('guide editor inserts a reference pill', inserted);
  // the Settings (pencil) button opens the properties panel — with no content editor in it
  await page.evaluate(() => document.querySelector('main .gtool-icon')?.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] .frm'), { timeout: 4000 });
  ok('guide settings panel holds properties, not the content editor', await page.evaluate(() => !!document.querySelector('[role="dialog"] .frm') && !document.querySelector('[role="dialog"] .ce')));
  await page.keyboard.press('Escape');

  // --- Guide nav: new group + drag a guide into it ---
  await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === '+ New group')?.click());
  const groupHeader = await page.waitForFunction(() => [...document.querySelectorAll('nav .navgroup-title')].some((t) => t.textContent.trim() === 'New group' || t.querySelector('input')?.value === 'New group'), { timeout: 4000 }).then(() => true).catch(() => false);
  ok('add nav group creates a group header', groupHeader);
  await page.evaluate(() => {
    // In edit mode guides drag from their grip handle (.navguide-grip).
    const grip = document.querySelector('nav .navrow .navguide-grip');
    const grp = [...document.querySelectorAll('nav .navgroup')].find((n) => n.querySelector('.navgroup-title input')?.value === 'New group' || n.querySelector('.navgroup-title')?.textContent.trim() === 'New group');
    if (!grip || !grp) return;
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    grp.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    grp.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });
  const intoGroup = await page.waitForFunction(() => {
    const grp = [...document.querySelectorAll('nav .navgroup')].find((n) => n.querySelector('.navgroup-title input')?.value === 'New group' || n.querySelector('.navgroup-title')?.textContent.trim() === 'New group');
    // In edit mode guides use navguide-child (input); in read mode navlink-child (button).
    return !!grp && !!(grp.querySelector('.navguide-child') || grp.querySelector('.navlink-child'));
  }, { timeout: 4000 }).then(() => true).catch(() => false);
  ok('drag a guide into a group (DnD reorder)', intoGroup);

  // --- Settings (package meta) ---
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings')?.click());
  await page.waitForFunction(() => /Settings/.test(document.body.innerText) && !!document.querySelector('[role="dialog"] .frm input'), { timeout: 6000 });
  ok('settings opens the meta form', true);
  await page.keyboard.press('Escape');

  // export icon opens the dialog with a password-protect option
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Export')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('Save a copy to disk'), { timeout: 5000 });
  await page.evaluate(() => { const lbl = [...document.querySelectorAll('[role="dialog"] label')].find((l) => /password/i.test(l.textContent)); const cb = lbl?.querySelector('input[type=checkbox]'); if (cb && !cb.checked) cb.click(); });
  const pwShown = await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[type=password]'), { timeout: 4000 }).then(() => true).catch(() => false);
  ok('export dialog offers password protection', pwShown);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(b => /suggest a passphrase/i.test(b.textContent))?.click());
  const phrase = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')].find(i => i.placeholder === 'Password or passphrase')?.value || '');
  ok('suggest generates a 6-word diceware passphrase', phrase.split('-').filter(Boolean).length === 6);
  ok('generated passphrase rates very strong', await page.evaluate(() => /very strong/i.test(document.querySelector('[role="dialog"] .pw-strength')?.textContent || '')));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Cancel')?.click());

  // Blur any focused field (e.g. the auto-focused new-group name input) so the shortcut isn't treated as typing.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Meta');
  await page.keyboard.press('KeyE');
  await page.keyboard.up('Meta');
  await page.waitForFunction(() => !!document.querySelector('.plan-edit'), { timeout: 6000 });
  ok('keyboard shortcut returns to read mode', true);

  ok('no runtime errors', errors.length === 0);
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Edit-mode smoke ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n errors:'); errors.forEach((e) => console.log('  - ' + e)); }
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${failed ? '✗ ' + failed + ' failed' : '✓ all passed'} (${results.length})\n`);
