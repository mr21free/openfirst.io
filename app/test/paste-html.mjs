// HTML paste → markdown conversion. Copying from Word, Google Docs, or a PDF
// viewer and pasting into the guide editor should carry over headings,
// bold/italic and lists instead of landing as flat plain text — while a
// plain-text-only clipboard (e.g. from a PDF viewer, which rarely offers
// text/html) must still fall through to the existing behavior unchanged.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS = 'file://' + resolve(__dirname, 'fixtures/paste-harness.html');
const APP = 'file://' + resolve(__dirname, '../dist/build/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const fixture = (name) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errors = [];

try {
  // --- Part A: htmlToMarkdown() against real-world fixtures ---
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(HARNESS, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 6000 });
  const convert = (html) => page.evaluate((h) => window.htmlToMarkdown(h), html);

  // Hand-authored, documented real clipboard pattern: Google Docs wraps the
  // whole fragment in a <b style="font-weight:normal"> reset, uses real
  // semantic <h1>/<h2>/<ol>/<ul>, and marks bold/italic via inline styles
  // rather than <b>/<i> tags.
  const gdocsClip = await convert(fixture('gdocs-clipboard.html'));
  ok('gdocs clipboard: real <h1> becomes a markdown heading', /^# .*First steps for Amanda/m.test(gdocsClip));
  ok('gdocs clipboard: <h2> becomes ##', /^## .*The first day/m.test(gdocsClip));
  ok('gdocs clipboard: the bold-reset wrapper is not treated as bold', !/^\*\*First steps/m.test(gdocsClip) || /^# /.test(gdocsClip.match(/^#.*First steps for Amanda.*$/m)?.[0] || ''));
  ok('gdocs clipboard: ordered list survives as flat numbered lines', /1\. Call the lawyer/.test(gdocsClip) && /2\. Secure the house/.test(gdocsClip) && /3\. Notify the bank/.test(gdocsClip));
  ok('gdocs clipboard: unordered list survives as dashes', /- Forward the mail/.test(gdocsClip) && /- Meet the accountant/.test(gdocsClip));
  ok('gdocs clipboard: style-based bold is recovered (not just tag-based)', /\*\*contains\*\*/.test(gdocsClip));
  ok('gdocs clipboard: combined bold+italic renders as both markers', /\*\*_Bitcoin_\*\*/.test(gdocsClip));

  // Hand-authored, documented Word clipboard pattern: lists are NOT real
  // <ul>/<ol> at all — flat <p style="mso-list:..."> paragraphs with the
  // visible marker glyph baked into the text via a nested "Ignore" span.
  const wordClip = await convert(fixture('word-clipboard.html'));
  ok('word clipboard: mso-list numbered paragraphs recovered as an ordered list', /1\. Call the lawyer/.test(wordClip) && /1\. Secure the house/.test(wordClip));
  ok('word clipboard: mso-list bullet paragraphs recovered as a bullet list', /- Forward the mail/.test(wordClip) && /- Meet the accountant/.test(wordClip));
  ok('word clipboard: the baked-in marker glyph ("1.", "·") is not duplicated in the text', !/Ignore/.test(wordClip) && !/1\.\s*1\./.test(wordClip) && !/·/.test(wordClip));
  ok('word clipboard: real <b>/<i> tags still map to bold/italic', /\*\*contains\*\*/.test(wordClip) && /Bitcoin/.test(wordClip));

  // Real fixtures: the user's own Google-Docs-exported .docx and a genuine
  // Word-authored .docx (downloaded from file-examples.com), both converted
  // to HTML via macOS's built-in `textutil` — this path does NOT use
  // semantic heading tags (styled <p class="pN"> instead), so headings are
  // expected to degrade to plain paragraphs rather than being guessed at.
  const gdocsExport = await convert(fixture('gdocs-export.html'));
  ok('gdocs docx export: bold/italic survive via real <b>/<i>', /\*\*/.test(gdocsExport) || /\*[^*]/.test(gdocsExport));
  ok('gdocs docx export: bullet list survives via real <ul><li>', /^- /m.test(gdocsExport));
  ok('gdocs docx export: no crash / produces non-empty markdown', gdocsExport.trim().length > 20);
  // textutil renders the docx's Title/Heading2 styles as plain <p class="pN">
  // (not <h1-6>) at a font-size just 4% above body text — the only way to
  // tell them from a same-sized body sentence is that a heading is short and
  // doesn't trail off with sentence punctuation the way real prose does.
  ok('gdocs docx export: non-semantic (textutil) headings are recovered via font-size', /^## .*First steps for Amanda/m.test(gdocsExport) && /^## The first day$/m.test(gdocsExport) && /^## The first week$/m.test(gdocsExport) && /^## The main rule$/m.test(gdocsExport));
  ok('gdocs docx export: a same-size body sentence is NOT misdetected as a heading', !/^## .*Do not rush/m.test(gdocsExport) && !/^## .*estate/m.test(gdocsExport));

  // Regression: a Preview.app PDF copy can fragment a wrapped line so an
  // orphaned closing quote or a lone bullet glyph lands in its own
  // same-size paragraph — neither has real word content and must not be
  // promoted to a heading just because it's short and unpunctuated.
  const pdfFragments = await convert('<p style="font-size:12px">Some real body sentence acting as filler text</p><p style="font-size:12px">Another real body sentence here too as filler</p><p style="font-size:12px">"</p><p style="font-size:12px">●</p>');
  ok('bare punctuation/bullet-glyph fragments (no word content) are not misdetected as headings', !/^#+ *"$/m.test(pdfFragments) && !/^#+ *●$/m.test(pdfFragments));

  // Real fixture: captured directly off the system clipboard (`osascript -e
  // 'the clipboard as «class HTML»'`) right after Cmd+A/Cmd+C on a real PDF
  // opened in macOS Preview — Preview's Cocoa HTML writer emits one <p> per
  // *visual* line, not per logical paragraph/list item, fragmenting wrapped
  // sentences and separating bullet glyphs from their text.
  const pdfPreview = await convert(fixture('pdf-preview-clipboard.html'));
  ok('pdf preview copy: a list item wrapped across two visual lines is rejoined', /^4\. Read .* broker accounts, or gold\.$/m.test(pdfPreview));
  ok('pdf preview copy: an orphaned closing quote is rejoined onto its sentence, not left standalone', /guide me\."$/m.test(pdfPreview) && !/^"$/m.test(pdfPreview));
  ok('pdf preview copy: four bullet-marker-only paragraphs are zipped with their following text into a real list', /^- Register the death/m.test(pdfPreview) && /^- Ask Eleanor Price/m.test(pdfPreview) && /^- Ask Rachel Green.*property records\.$/m.test(pdfPreview) && /^- Ask Luca Bianchi.*tenant reassured\.$/m.test(pdfPreview));
  ok('pdf preview copy: no stray bullet-glyph-only line survives on its own', !/^●$/m.test(pdfPreview));
  ok('pdf preview copy: a real <h2>-equivalent heading ("The main rule") still comes through', /^#+ The main rule$/m.test(pdfPreview));
  ok('pdf preview copy: section titles with no font-size distinction stay plain, not merged into the next list item', /^The first day$/m.test(pdfPreview) && /^The first week$/m.test(pdfPreview));

  // Real fixture: captured directly off the system clipboard right after a
  // live Cmd+A/Cmd+C in the actual Google Docs web editor (not the file
  // export, and not the hand-authored gdocs-clipboard.html pattern above).
  // Unlike textutil's docx export, Google Docs never puts a font-size on the
  // <p> itself — only on the inline <span> run(s) inside it — so the Title
  // style's 26pt only shows up on its child span, which fontSizePx() must
  // fall back to.
  const gdocsLive = await convert(fixture('gdocs-live-clipboard.html'));
  ok('gdocs live clipboard: the Title style (26pt span, no size on the <p>) is recovered as a heading', /^# .*First steps for Amanda/m.test(gdocsLive));
  ok('gdocs live clipboard: a real <h2> still comes through natively', /^## The main rule$/m.test(gdocsLive));
  ok('gdocs live clipboard: a real <ol> survives as a numbered list', /^1\. Be with Thomas/m.test(gdocsLive) && /^5\. Use the Death administration/m.test(gdocsLive));
  ok('gdocs live clipboard: a real <ul> survives as a dash list', /^- Register the death/m.test(gdocsLive) && /^- Ask Luca Bianchi/m.test(gdocsLive));
  ok('gdocs live clipboard: style-based bold/italic on plain <span> runs still recovered', /\*\*contains\*\*/.test(gdocsLive) && /\*assets\*/.test(gdocsLive));
  ok('gdocs live clipboard: section titles with no size distinction on the <p> stay plain, not misdetected', /^The first day$/m.test(gdocsLive) && /^The first week$/m.test(gdocsLive));

  const wordExport = await convert(fixture('word-export.html'));
  ok('word docx export: bold+italic runs survive', /\*\*_[^_]+_\*\*/.test(wordExport));
  ok('word docx export: a <ul> directly nested inside another <ul> (no <li> wrapper) is not dropped', /Maecenas mauris lectus/.test(wordExport));
  ok('word docx export: table degrades to plain rows instead of crashing/vanishing', /Lorem ipsum/.test(wordExport));
  ok('word docx export: empty/whitespace-only paragraphs contribute no blank noise lines', !/\n{3,}/.test(wordExport));
  ok('word docx export: the doc Title (12px vs. a 10.5px body) is recovered as a heading', /^## Lorem ipsum$/m.test(wordExport));

  await page.close();

  // --- Part B: wired into the real editor (build must be current) ---
  const app = await browser.newPage();
  const clickText = (t) => app.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(t)); if (b) { b.click(); return true; } return false; }, t);
  app.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await app.goto(APP, { waitUntil: 'load' });
  await app.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create new plan'), { timeout: 8000 });
  await (await app.$('input[type="file"]')).uploadFile(resolve(__dirname, '../src/sample/lifepackage.json'));
  await app.waitForFunction(() => /who are you/i.test(document.body.innerText), { timeout: 8000 });
  await clickText('Admin');
  await app.waitForFunction(() => !!document.querySelector('.plan-edit'), { timeout: 8000 });
  await app.keyboard.down('Meta'); await app.keyboard.press('KeyE'); await app.keyboard.up('Meta');
  await app.waitForFunction(() => !!document.querySelector('nav .nav-add-row'), { timeout: 6000 });
  await clickText('+ New');
  await app.evaluate(() => [...document.querySelectorAll('.newpop button')].find((b) => b.textContent.includes('Guide'))?.click());
  await app.waitForFunction(() => !!document.querySelector('main .ce .ce-edit'), { timeout: 6000 });

  const pasteInto = (html, text) => app.evaluate(({ html, text }) => {
    const el = document.querySelector('main .ce .ce-edit');
    el.focus();
    const dt = new DataTransfer();
    if (html != null) dt.setData('text/html', html);
    if (text != null) dt.setData('text/plain', text);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    el.dispatchEvent(evt);
  }, { html, text });

  // Rich HTML paste converts to markdown.
  await pasteInto('<h2>The first day</h2><ul><li>Call the lawyer</li></ul><p>The estate <b>contains</b> a house.</p>', 'The first day\nCall the lawyer\nThe estate contains a house.');
  const htmlPasted = await app.evaluate(() => document.querySelector('main .ce .ce-edit').textContent);
  ok('paste with text/html converts rich formatting into markdown source', /## The first day/.test(htmlPasted) && /- Call the lawyer/.test(htmlPasted) && /\*\*contains\*\*/.test(htmlPasted));

  // Clear the editor, then paste plain-text-only (no text/html) — the PDF
  // case — and confirm it still falls through unchanged, exactly as before.
  await app.evaluate(() => { const el = document.querySelector('main .ce .ce-edit'); el.focus(); document.execCommand('selectAll'); document.execCommand('delete'); });
  await pasteInto(null, 'Plain PDF-copied text with no rich formatting.');
  const plainPasted = await app.evaluate(() => document.querySelector('main .ce .ce-edit').textContent);
  ok('paste with only text/plain (PDF case) is unaffected — passes through as-is', plainPasted.trim() === 'Plain PDF-copied text with no rich formatting.');

  await app.close();
} catch (e) {
  errors.push('exception: ' + (e?.stack || e));
} finally {
  await browser.close();
}

console.log('\n=== Paste HTML → Markdown ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
if (errors.length) { bad += errors.length; console.log('  Errors:'); for (const e of errors) console.log('   -', e); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
