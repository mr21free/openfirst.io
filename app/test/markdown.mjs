// Markdown: unordered lists nest by dash count — "-" level 0, "--" level 1,
// "---" level 2 — while "---" on its own line stays a horizontal rule.
import { renderMarkdown } from '../src/lib/markdown.js';

const results = []; const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

ok('flat bullets', renderMarkdown('- a\n- b') === '<ul><li>a</li><li>b</li></ul>');
ok('one dash deeper (--) nests under the previous item',
  renderMarkdown('- a\n-- b\n- c') === '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
ok('two levels (--- under --)',
  renderMarkdown('- top\n-- c1\n-- c2\n--- deep\n- next')
  === '<ul><li>top<ul><li>c1</li><li>c2<ul><li>deep</li></ul></li></ul></li><li>next</li></ul>');
ok('"---" on its own line is still a horizontal rule', renderMarkdown('a\n\n---\n\nb').includes('<hr'));
ok('"--- text" is a nested bullet, not a rule',
  !renderMarkdown('--- x').includes('<hr') && /<li>x/.test(renderMarkdown('--- x')));
ok('a bullet right after a paragraph still starts a list',
  /<p>intro<\/p>\s*<ul><li>one/.test(renderMarkdown('intro\n- one\n- two')));
ok('refs/formatting still work inside a nested bullet',
  renderMarkdown('- a\n-- **bold**').includes('<strong>bold</strong>'));

console.log('\n=== Markdown nested bullets ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
