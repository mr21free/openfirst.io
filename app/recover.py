#!/usr/bin/env python3
"""
Standalone recovery tool for an OpenFirst plan (.html) file.

This exists for the day the app itself is unavailable: it needs no build
step, no browser, and no network. It only needs Python and the widely-used
`cryptography` package (`pip install cryptography`), which supplies PBKDF2
and AES-GCM. See FORMAT.md, section "The Plan File (.html) — Container
Format v1", for the full container spec this script implements.

Usage:
    python3 recover.py PLAN.html                      # passphrase-free plan
    python3 recover.py PLAN.html --passphrase "..."   # protected plan
    python3 recover.py PLAN.html -o lifepackage.json  # write to a file instead of stdout

Exit codes: 0 on success, 1 on a recoverable error (bad passphrase, no
matching slot, malformed file), printed to stderr with a plain explanation.
"""

import argparse
import base64
import json
import re
import sys

# Requires type="application/json" (not just the id) — every real plan file
# also embeds this very script's source for future re-export, and that
# source's own error message below contains the literal text
# `<script id="openfirst-plan-data">`, which a looser regex would match
# first (and wrongly) before ever reaching the real data island.
DATA_ISLAND_RE = re.compile(
    r'<script[^>]*type=["\']application/json["\'][^>]*id=["\']openfirst-plan-data["\'][^>]*>(.*?)</script>',
    re.DOTALL,
)

SUPPORTED_FORMAT = 'lifepackage-plan/v1'
AAD_VERSION = 'v1'


def extract_container(html_text):
    m = DATA_ISLAND_RE.search(html_text)
    if not m:
        raise ValueError('Could not find the plan\'s data island (expected a script tag, type "application/json", id "openfirst-plan-data") in this file.')
    return json.loads(m.group(1))


def aad_main(plan_id, revision):
    return f'lifepackage-plan-aad/{AAD_VERSION}\n{plan_id}\n{revision}'.encode('utf-8')


def aad_slot(plan_id, slot_id, label, hint):
    return f'lifepackage-plan-slot-aad/{AAD_VERSION}\n{plan_id}\n{slot_id}\n{label}\n{hint or ""}'.encode('utf-8')


def derive_key(passphrase, salt, iterations):
    # Lazy import so `--help` and plaintext-plan recovery work even without
    # the cryptography package installed.
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode('utf-8'))


def aes_gcm_decrypt(key, iv, ciphertext_with_tag, aad):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM(key).decrypt(iv, ciphertext_with_tag, aad)


def unwrap_master_key(slot, passphrase, plan_id):
    key = derive_key(passphrase, base64.b64decode(slot['salt']), slot['iterations'])
    iv = base64.b64decode(slot['iv'])
    wrapped = base64.b64decode(slot['wrappedKey'])
    aad = aad_slot(plan_id, slot['id'], slot.get('label', ''), slot.get('hint', ''))
    return aes_gcm_decrypt(key, iv, wrapped, aad)


def decrypt_data(container, master_key_raw):
    iv = base64.b64decode(container['iv'])
    ciphertext = base64.b64decode(container['data'])
    aad = aad_main(container['planId'], container['revision'])
    plaintext = aes_gcm_decrypt(master_key_raw, iv, ciphertext, aad)
    return json.loads(plaintext.decode('utf-8'))


def recover(container, passphrase):
    if container.get('format') != SUPPORTED_FORMAT:
        raise ValueError(
            f'Unrecognized container format "{container.get("format")}" '
            f'(this script knows {SUPPORTED_FORMAT}). Check FORMAT.md for the format history.'
        )

    if container.get('protection') == 'none':
        return container['data']

    if container.get('protection') != 'passphrase':
        raise ValueError(f'Unrecognized protection mode "{container.get("protection")}".')

    if not passphrase:
        labels = ', '.join(s.get('label', '(unlabeled)') for s in container.get('slots', []))
        raise ValueError(f'This plan is passphrase-protected. Pass --passphrase. Slots on this file: {labels}')

    errors = []
    for slot in container.get('slots', []):
        try:
            master_key_raw = unwrap_master_key(slot, passphrase, container['planId'])
            return decrypt_data(container, master_key_raw)
        except Exception as exc:  # wrong passphrase for this slot — try the next one
            errors.append(f'{slot.get("label", slot.get("id"))}: {exc}')
            continue

    raise ValueError(
        'That passphrase did not unlock any slot on this file.\n' +
        '\n'.join(f'  - {e}' for e in errors)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('plan_html', help='Path to the plan .html file')
    parser.add_argument('--passphrase', help='Passphrase for a protected plan (tried against every slot)')
    parser.add_argument('-o', '--output', help='Write recovered JSON here instead of stdout')
    args = parser.parse_args()

    try:
        with open(args.plan_html, 'r', encoding='utf-8') as f:
            html_text = f.read()
        container = extract_container(html_text)
        data = recover(container, args.passphrase)
    except Exception as exc:
        print(f'Could not recover this plan: {exc}', file=sys.stderr)
        sys.exit(1)

    out = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out)
        print(f'Wrote {args.output}', file=sys.stderr)
    else:
        sys.stdout.write(out)


if __name__ == '__main__':
    main()
