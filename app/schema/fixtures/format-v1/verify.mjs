// Cross-checks recover.js (canonical) against recover.py (secondary worked
// example) on every format-v1 fixture: both must produce byte-identical
// recovered JSON for every passphrase, and both must fail (not just one of
// them) on a wrong or missing passphrase. This is what keeps "recover.py is
// a second worked example" an honest claim rather than an unverified one.
//
// Run locally: node schema/fixtures/format-v1/verify.mjs
// Runs in CI on every change to recover.js, recover.py, or a fixture.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../../..');
const RECOVER_JS = resolve(APP_ROOT, 'recover.js');
const RECOVER_PY = resolve(APP_ROOT, 'recover.py');
const manifest = JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8'));

const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || String(err.message || err) };
  }
}

function recoverWithNode(file, passphrase) {
  const args = [RECOVER_JS, resolve(HERE, file)];
  if (passphrase) args.push('--passphrase', passphrase);
  return run('node', args);
}

function recoverWithPython(file, passphrase) {
  const args = [RECOVER_PY, resolve(HERE, file)];
  if (passphrase) args.push('--passphrase', passphrase);
  return run('python3', args);
}

// The Python path depends on `pip install cryptography`, which isn't always
// present on a dev machine (see FORMAT.md). Detect it once, and skip (not
// fail) the cross-checks that need it when it's missing, so this script
// stays useful without it — CI installs it, so the real cross-check still
// runs there.
const pyProbe = run('python3', ['-c', 'from cryptography.hazmat.primitives.ciphers.aead import AESGCM']);
const pythonAvailable = pyProbe.status === 0;
if (!pythonAvailable) {
  console.log('(!) Python `cryptography` package not found — skipping recover.js vs recover.py cross-checks.');
  console.log('    Install it to run the full check: pip install cryptography');
}

function checkCase(file, label, passphrase, expectSuccess) {
  const nodeRes = recoverWithNode(file, passphrase);
  ok(`node recover.js ${file} ${label}: ${expectSuccess ? 'succeeds' : 'fails'}`, (nodeRes.status === 0) === expectSuccess);

  if (!pythonAvailable) return nodeRes;
  const pyRes = recoverWithPython(file, passphrase);
  ok(`python recover.py ${file} ${label}: ${expectSuccess ? 'succeeds' : 'fails'}`, (pyRes.status === 0) === expectSuccess);

  if (expectSuccess && nodeRes.status === 0 && pyRes.status === 0) {
    ok(`${file} ${label}: node and python agree on recovered data`, nodeRes.stdout === pyRes.stdout);
  }
  return nodeRes;
}

let referenceData = null;

for (const fixture of manifest.fixtures) {
  if (fixture.protection === 'none') {
    const res = checkCase(fixture.file, '(no passphrase)', null, true);
    if (res.status === 0) referenceData = res.stdout;
    continue;
  }

  for (const slot of fixture.slots) {
    const res = checkCase(fixture.file, `slot "${slot.label}"`, slot.passphrase, true);
    if (referenceData !== null && res.status === 0) {
      ok(`${fixture.file} slot "${slot.label}": recovered data matches the plaintext fixture`, res.stdout === referenceData);
    }
  }

  // Wrong passphrase must fail — for every slot's own key, not just the first.
  checkCase(fixture.file, '(wrong passphrase)', 'this is not the right passphrase', false);
  // No passphrase at all on a protected file must also fail, not hang or silently return something.
  checkCase(fixture.file, '(no passphrase given)', null, false);
}

console.log('\n=== Format v1: recover.js vs recover.py ===');
let bad = 0;
for (const [status, name] of results) { if (status === 'FAIL') bad++; console.log(`  [${status}] ${name}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
