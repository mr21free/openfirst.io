// Item attachments:
//  A) READ mode renders image attachments INLINE (a photo beats a filename),
//     resolved from the attachment URL, clickable to open full (Demo = real img).
//  B) READ order for an item is name → description → attachments → notes, and a
//     non-image file shows its TYPE ("PDF"), not the word "Attachment".
//  C) Item<->file links are unified (a file attached from the FILE side shows on
//     the item form; legacy item.attachment_ids normalize on load); the edit
//     picker lists files A→Z with no redundant "(file)" suffix.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const pause = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errs = [];
const showEverything = (pg) => pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /show me everything|admin/i.test(b.textContent))?.click());

try {
  const dir = mkdtempSync(resolve(tmpdir(), 'lp-att-'));

  // ---- A: inline image in the item read view ----
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luz+wwAAAABJRU5ErkJggg==', 'base64'));
  const imgPlan = {
    schema: 'inheritance-package/v1',
    package: { title: 'Image attachment test', languages: ['en'], default_language: 'en' },
    people: [{ id: 'p1', name: 'Reader' }],
    items: [{ id: 'i_img', name: 'Inline photo item', importance: 'medium', description: 'Has a photo.', attachment_ids: ['a_img'] }],
    attachments: [{ id: 'a_img', filename: 'demo.png', path: 'attachments/demo.png', mime: 'image/png', description: 'Photo', item_ids: ['i_img'] }]
  };
  const imgZip = zipSync({
    'image-package/inheritance.json': new TextEncoder().encode(JSON.stringify(imgPlan)),
    'image-package/attachments/demo.png': png
  });
  const imgZipPath = resolve(dir, 'image-package.zip');
  writeFileSync(imgZipPath, imgZip);

  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await page.$('input[type=file]:not([webkitdirectory])')).uploadFile(imgZipPath);
  await page.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await showEverything(page);
  await page.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Items/.test(b.textContent))?.click());
  await page.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Items', { timeout: 6000 });
  ok('items list flags an item that has attachments (icon)', await page.evaluate(() =>
    !![...document.querySelectorAll('main .ulist-row')].find((r) => /Inline photo item/i.test(r.textContent))?.querySelector('.clip-ico')));
  await page.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => /Inline photo item/i.test(r.textContent))?.click());
  await page.waitForFunction(() => !!document.querySelector('.drawer .dbody'), { timeout: 6000 });
  await pause();
  ok('item detail gives importance a section title', await page.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .dbody .field')].find((x) => x.querySelector('.muted')?.textContent.trim() === 'Importance');
    return !!f && /Medium/i.test(f.textContent);
  }));
  const img = await page.evaluate(() => {
    const fig = document.querySelector('.drawer .att-figure img.att-img');
    return fig ? { ok: true, complete: fig.complete, w: fig.naturalWidth } : { ok: false };
  });
  ok('item read view shows the attachment as an inline image', img.ok);
  ok('the inline image actually resolved (decoded pixels)', img.ok && img.complete && img.w > 0);
  await page.evaluate(() => document.querySelector('.drawer .att-figure')?.click());
  await page.waitForFunction(() => /Attachment/i.test(document.querySelector('.drawer .eyebrow')?.textContent || ''), { timeout: 5000 }).then(() => ok('clicking the inline image opens the file', true)).catch(() => ok('clicking the inline image opens the file', false));
  await pause();
  const attOrder = await page.evaluate(() => {
    const kids = [...document.querySelector('.drawer .dbody').children];
    return {
      img: kids.findIndex((k) => k.tagName === 'IMG' || k.querySelector?.('img.att-img, iframe.att-pdf')),
      attachedTo: kids.findIndex((k) => k.classList?.contains('field') && /Attached to/.test(k.textContent)),
      actions: kids.findIndex((k) => k.classList?.contains('attachment-actions')),
      last: kids.length - 1
    };
  });
  ok('attachment view puts "Attached to" below the image/pdf', attOrder.img >= 0 && attOrder.attachedTo > attOrder.img);
  ok('Download/Print actions are the very last thing', attOrder.actions > attOrder.attachedTo && attOrder.actions === attOrder.last);
  await page.close();

  // Fixture used by B + C. No file bytes, so images fall back to list rows —
  // perfect for testing ordering, type labels and the picker.
  const fixture = {
    schema: 'inheritance-package/v1',
    package: { title: 'Attach test', primary_person_ids: ['p1'] },
    people: [{ id: 'p1', name: 'Reader' }],
    items: [
      { id: 'i_file', name: 'SIM card', description: 'Pre-paid number.', notes: 'Keep it topped up.' },
      { id: 'i_legacy', name: 'Old box', attachment_ids: ['a_pdf'] }
    ],
    attachments: [
      { id: 'a_zeb', filename: 'Zebra.jpeg', mime: 'image/jpeg', item_ids: ['i_file'] },
      { id: 'a_app', filename: 'Apple.pdf', mime: 'application/pdf', item_ids: ['i_file'] },
      { id: 'a_pdf', filename: 'will.pdf', mime: 'application/pdf' } // folded onto i_legacy on load
    ]
  };
  const fpath = resolve(dir, 'plan.json');
  writeFileSync(fpath, JSON.stringify(fixture));

  // ---- B: read order + file-type labels ----
  const pb = await browser.newPage();
  pb.on('pageerror', (e) => errs.push(e.message));
  await pb.goto(FILE, { waitUntil: 'load' });
  await pb.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await pb.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await pb.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await showEverything(pb);
  await pb.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await pb.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Items/.test(b.textContent))?.click());
  await pb.waitForFunction(() => document.querySelector('main .vh')?.textContent.trim() === 'Items', { timeout: 6000 });
  await pb.evaluate(() => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => /SIM card/.test(r.textContent))?.click());
  await pb.waitForFunction(() => !!document.querySelector('.drawer .dbody'), { timeout: 6000 });
  await pause();
  const order = await pb.evaluate(() => {
    const kids = [...document.querySelector('.drawer .dbody').children];
    const at = (pred) => kids.findIndex(pred);
    return {
      desc: at((k) => k.tagName === 'P' && /Pre-paid/.test(k.textContent)),
      att: at((k) => k.classList.contains('field') && /^Attachments/.test(k.textContent.trim())),
      notes: at((k) => k.classList.contains('field') && /^Notes/.test(k.textContent.trim()))
    };
  });
  ok('item read order is description → attachments → notes', order.desc >= 0 && order.att > order.desc && order.notes > order.att);
  const descs = await pb.evaluate(() => [...document.querySelectorAll('.drawer .ulist-row .ulist-desc')].map((d) => d.textContent.trim()));
  ok('non-image file shows its type (PDF), never the word "Attachment"', descs.includes('PDF') && !descs.includes('Attachment'));
  await pb.close();

  // ---- C: edit form — unified links, A→Z order, no "(file)" ----
  const pc = await browser.newPage();
  pc.on('pageerror', (e) => errs.push(e.message));
  await pc.goto(FILE, { waitUntil: 'load' });
  await pc.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /open existing plan/i.test(b.textContent)), { timeout: 8000 });
  await (await pc.$('input[type=file]:not([webkitdirectory])')).uploadFile(fpath);
  await pc.waitForFunction(() => /who are you/i.test(document.body.innerText) || !!document.querySelector('nav .navcount'), { timeout: 8000 });
  await showEverything(pc);
  await pc.waitForFunction(() => !!document.querySelector('nav .navlink-section'), { timeout: 8000 });
  await pc.evaluate(() => document.querySelector('.plan-edit')?.click()); await pause(400);
  const openItemForm = async (nameRe) => {
    await pc.evaluate(() => [...document.querySelectorAll('nav .navlink-section')].find((b) => /Items/.test(b.textContent))?.click());
    await pause(250);
    await pc.evaluate((re) => [...document.querySelectorAll('main .ulist .ulist-click')].find((r) => new RegExp(re).test(r.textContent))?.click(), nameRe);
    await pc.waitForFunction(() => !!document.querySelector('.drawer .frm'), { timeout: 6000 });
    await pause(200);
  };
  const attachField = () => pc.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === 'Attachments');
    return {
      chips: [...(f?.querySelectorAll('.pchip') || [])].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      options: [...(f?.querySelectorAll('option') || [])].map((o) => o.textContent.trim())
    };
  });

  await openItemForm('SIM card');
  const f1 = await attachField();
  ok('file-side links (attachment.item_ids) show on the item form', f1.chips.some((t) => /Apple\.pdf/.test(t)) && f1.chips.some((t) => /Zebra\.jpeg/.test(t)));
  ok('attachments are ordered A→Z', f1.chips.findIndex((t) => /Apple/.test(t)) < f1.chips.findIndex((t) => /Zebra/.test(t)));
  ok('no redundant "(file)" suffix in the picker', !f1.options.some((o) => /\(file\)/i.test(o)) && !f1.chips.some((t) => /\(file\)/i.test(t)));
  const dependsOpts = await pc.evaluate(() => {
    const f = [...document.querySelectorAll('.drawer .frm .f')].find((x) => x.querySelector('.lbl')?.textContent.trim() === 'Depends on');
    return [...(f?.querySelectorAll('option') || [])].map((o) => o.textContent.trim());
  });
  ok('no redundant "(item)" suffix in item pickers', dependsOpts.length > 0 && !dependsOpts.some((o) => /\(item\)/i.test(o)));
  await pc.evaluate(() => document.querySelector('.scrim')?.click()); await pause(200);

  await openItemForm('Old box');
  const f2 = await attachField();
  ok('legacy item.attachment_ids normalized → shows on the item form', f2.chips.some((t) => /will\.pdf/.test(t)));

  ok('no runtime errors', errs.length === 0);
  rmSync(dir, { recursive: true, force: true });
} catch (e) { ok('flow threw: ' + e.message, false); }
finally { await browser.close(); }

console.log('\n=== Item attachments (inline images + types + unified links) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
