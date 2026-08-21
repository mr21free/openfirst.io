#!/usr/bin/env python3
"""
Standalone recovery tool for an OpenFirst plan (.html) file.

This exists for the day the app itself is unavailable: it needs no build
step, no browser, and no network. It only needs Python and the widely-used
`cryptography` package (`pip install cryptography`), which supplies PBKDF2
and AES-GCM. See FORMAT.md, sections "Container Format v1" and "Container
Format v2", for the full container spec this script implements — it reads
both (every plan ever exported keeps opening, forever) and always prints
the same plain JSON shape regardless of which one the file happens to be in.

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


# Binds `formatVersion` — otherwise-unauthenticated plaintext that decides
# whether this script even looks at the top-level `attachments` map below.
# Without this, flipping formatVersion from 2 to 1 on a tampered file makes
# every attachment silently disappear instead of being caught as tampering.
def aad_main(plan_id, revision, format_version):
    return f'lifepackage-plan-aad/v2\n{plan_id}\n{revision}\n{format_version}'.encode('utf-8')


# Pre-formatVersion-binding AAD, from before the guard above existed — kept
# so a file written before this fix still opens (see decrypt_data). A newly
# written, newly tampered file still fails here too: its ciphertext tag was
# computed under aad_main's *real* formatVersion, which this legacy string
# never included, so the two only ever coincide for a genuinely old file.
def aad_main_legacy(plan_id, revision):
    return f'lifepackage-plan-aad/{AAD_VERSION}\n{plan_id}\n{revision}'.encode('utf-8')


def aad_slot(plan_id, slot_id, label, hint):
    return f'lifepackage-plan-slot-aad/{AAD_VERSION}\n{plan_id}\n{slot_id}\n{label}\n{hint or ""}'.encode('utf-8')


# Container Format v2 only — each attachment is its own independently
# encrypted entry (own iv, AAD bound to plan + attachment id, not revision)
# so an unchanged attachment's ciphertext can be cached and reused across
# saves instead of re-encrypted every time. See FORMAT.md. `mime` is bound
# too, so a tampered content-type on a protected attachment is caught rather
# than silently trusted by whatever renders it.
def aad_attachment(plan_id, attachment_id, mime):
    return f'lifepackage-plan-attachment-aad/v2\n{plan_id}\n{attachment_id}\n{mime or ""}'.encode('utf-8')


# Pre-mime-binding AAD — see aad_main_legacy above for why this has to stay.
def aad_attachment_legacy(plan_id, attachment_id):
    return f'lifepackage-plan-attachment-aad/{AAD_VERSION}\n{plan_id}\n{attachment_id}'.encode('utf-8')


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


def decrypt_main(container, master_key_raw):
    # Tries the current formatVersion-bound AAD first, then falls back to the
    # pre-fix AAD (see aad_main_legacy) — mirrors the per-slot try/fallback
    # in recover() below.
    iv = base64.b64decode(container['iv'])
    ciphertext = base64.b64decode(container['data'])
    try:
        aad = aad_main(container['planId'], container['revision'], container.get('formatVersion'))
        return aes_gcm_decrypt(master_key_raw, iv, ciphertext, aad)
    except Exception:
        aad = aad_main_legacy(container['planId'], container['revision'])
        return aes_gcm_decrypt(master_key_raw, iv, ciphertext, aad)


def decrypt_attachment_entry(container, att_id, entry, master_key_raw):
    # Tries the current mime-bound AAD first, then falls back to the pre-fix
    # AAD (see aad_attachment_legacy) — mirrors decrypt_main's fallback.
    entry_iv = base64.b64decode(entry['iv'])
    entry_ciphertext = base64.b64decode(entry['data'])
    try:
        aad = aad_attachment(container['planId'], att_id, entry.get('mime'))
        return aes_gcm_decrypt(master_key_raw, entry_iv, entry_ciphertext, aad)
    except Exception:
        aad = aad_attachment_legacy(container['planId'], att_id)
        return aes_gcm_decrypt(master_key_raw, entry_iv, entry_ciphertext, aad)


def decrypt_data(container, master_key_raw):
    plaintext = decrypt_main(container, master_key_raw)
    data = json.loads(plaintext.decode('utf-8'))
    # Container Format v2: attachment bytes live in their own top-level
    # `attachments` map, each independently encrypted (see aad_attachment
    # above), not merged into `data`. Decrypt them and merge them back into
    # `data['attachmentBlobs']` here so the JSON this script prints looks
    # identical to what a v1 file (attachments embedded in `data` already)
    # has always produced.
    if container.get('formatVersion', 1) >= 2 and container.get('attachments'):
        attachment_blobs = {}
        for att_id, entry in container['attachments'].items():
            entry_plain = decrypt_attachment_entry(container, att_id, entry, master_key_raw)
            attachment_blobs[att_id] = {
                'mime': entry.get('mime', ''),
                'b64': base64.b64encode(entry_plain).decode('ascii'),
            }
        data['attachmentBlobs'] = attachment_blobs
    return data


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
