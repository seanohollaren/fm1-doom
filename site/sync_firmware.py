#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Copy a firmware build into the site, so that the site can be built and deployed without the firmware toolchain:

  site/sync_firmware.py VERSION

  frontend/public/firmware/doom-VERSION.fwsc   the firmware alone (firmware/build/doom_code.fwsc; no game data)
  frontend/public/whdgen/whd_gen_es.{js,wasm}  rp2040-doom's data converter for the browser (web/build_whdgen.sh)
  frontend/public/licenses/                    the licence texts that travel with those two
  frontend/src/firmware.json                   the numbers the page needs (and checks the download against)

Run it after firmware/pack.py and web/build_whdgen.sh, then commit the changed files: the copies ARE the release.
Only publish a build that has run on a real FM-1.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "firmware" / "build"
WHDGEN = ROOT / "web" / "build" / "whdgen"
FEL = ROOT / "Felucca"
PUB = ROOT / "site" / "frontend" / "public"
LICENCES = [
    (FEL / "LICENSE", "GPL-3.0.txt"),
    (ROOT / "rp2040-doom" / "COPYING.md", "GPL-2.0.txt"),
    (FEL / "LICENSES" / "Apache-2.0.txt", "Apache-2.0.txt"),
    (ROOT / "rp2040-doom" / "src" / "adpcm-xq" / "license.txt", "BSD-3-Clause-adpcm-xq.txt"),
]


def main(version):
    tag = re.sub(r"[^A-Za-z0-9.-]", "-", version)
    # the commit the firmware was built from: the page links to it, so the source of the served binary can be found
    git = lambda *a: subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True, check=True).stdout.strip()
    if git("status", "--porcelain", "--", "firmware", "engine"):
        raise SystemExit("sync_firmware: firmware/ or engine/ has uncommitted changes: commit them, then build, then sync")
    commit = git("rev-parse", "HEAD")
    info = json.loads((BUILD / "doom_install.json").read_text())
    pkg = (BUILD / "doom_code.fwsc").read_bytes()
    for k in ("img_len", "desc_at", "app_slot"):
        if k not in info:
            raise SystemExit("sync_firmware: doom_install.json is from an older firmware/pack.py; run it again")
    for d in ("firmware", "whdgen", "licenses"):
        (PUB / d).mkdir(parents=True, exist_ok=True)
    for old in (PUB / "firmware").glob("doom-*.fwsc"):
        old.unlink()
    name = f"doom-{tag}.fwsc"
    (PUB / "firmware" / name).write_bytes(pkg)
    for f in ("whd_gen_es.js", "whd_gen_es.wasm"):
        if not (WHDGEN / f).exists():
            raise SystemExit("sync_firmware: no data converter; run web/build_whdgen.sh")
        shutil.copy(WHDGEN / f, PUB / "whdgen" / f)
    for src, dst in LICENCES:
        shutil.copy(src, PUB / "licenses" / dst)
    meta = {
        "version": version,
        "file": f"firmware/{name}",
        "sha256": hashlib.sha256(pkg).hexdigest(),
        "product": info["product"], "build": info["build"], "core": info["core"],
        "img_len": info["img_len"], "desc_at": info["desc_at"], "app_slot": info["app_slot"],
        "converter_sha256": hashlib.sha256((WHDGEN / "whd_gen_es.wasm").read_bytes()).hexdigest(),
        "source_commit": commit,
    }
    (ROOT / "site" / "frontend" / "src" / "firmware.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"site: firmware {version} ({len(pkg)} B package, image {info['img_len']} B, build {info['build']:08x}, source {commit[:7]}), "
          f"converter {(WHDGEN / 'whd_gen_es.wasm').stat().st_size} B, {len(LICENCES)} licence texts")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
