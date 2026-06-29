// Rebuilds the derived sample artifacts from the canonical folder:
//   public/sample-package/ (source of truth)
//     → src/sample/inheritance.json  (bundled into the app for "Try the sample")
//     → public/sample-package.zip
//     → public/sample-package.encrypted.json  (password: open-sesame-2026)
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { zipSync } from 'fflate';
import { encryptToEnvelope } from '../src/lib/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '../public');
const pkgDir = join(pub, 'sample-package');

// 1. bundled copy
copyFileSync(join(pkgDir, 'inheritance.json'), resolve(__dirname, '../src/sample/inheritance.json'));

// 2. zip the folder (entries keep the "sample-package/..." prefix)
const files = {};
const walk = (dir, base) => {
  for (const e of readdirSync(dir)) {
    if (e === '.DS_Store') continue;
    const full = join(dir, e);
    const rel = base ? `${base}/${e}` : e;
    if (statSync(full).isDirectory()) walk(full, rel);
    else files[rel] = new Uint8Array(readFileSync(full));
  }
};
walk(pkgDir, 'sample-package');
const zip = zipSync(files, { level: 6 });
writeFileSync(join(pub, 'sample-package.zip'), zip);

// 3. encrypted variant
const PASSWORD = 'open-sesame-2026';
const envelope = await encryptToEnvelope(zip, PASSWORD, {
  hint: 'Two words and the year, lowercase, hyphen-separated (this is just the demo password).'
});
writeFileSync(join(pub, 'sample-package.encrypted.json'), JSON.stringify(envelope, null, 2));

console.log('zip entries:', Object.keys(files).length, '| zip bytes:', zip.length);
console.log('encrypted:', envelope.cipher, envelope.kdf, envelope.iterations, '| password:', PASSWORD);
