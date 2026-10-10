#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Make the one-button installer site from the last firmware/pack.py run:

  web/make_installer.py VERSION OUT_DIR

  OUT_DIR/index.html        web/installer.html with Felucca's fm1pkg.js + fm1ota.js and the build's numbers inlined
  OUT_DIR/doom-VERSION.fwsc firmware + data block 1 (firmware/build/doom_part1.fwsc; Felucca's unmodified loader)
  OUT_DIR/doom-VERSION.dat  data block 2 (firmware/build/doom_data2.bin)

The files carry game data cut from the shareware doom1.wad: for local use; do not publish them.
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "firmware" / "build"
FEL = ROOT / "Felucca" / "web"


def strip_module(src):                      # as Felucca's web/make_site.py
    src = re.sub(r"^export\s+", "", src, flags=re.M)
    return re.sub(r"^import .*?;\n", "", src, flags=re.M)


def main(version, out):
    out = Path(out)
    info = json.loads((BUILD / "doom_install.json").read_text())
    pkg, dat = BUILD / "doom_part1.fwsc", BUILD / "doom_data2.bin"
    if dat.stat().st_size != info["data2_len"]:
        raise SystemExit("make_installer: doom_data2.bin does not match doom_install.json (run firmware/pack.py)")
    tag = re.sub(r"[^A-Za-z0-9.-]", "-", version)
    html = (ROOT / "web" / "installer.html").read_text(encoding="utf-8")
    lib = strip_module((FEL / "fm1pkg.js").read_text(encoding="utf-8")) + "\n" + strip_module((FEL / "fm1ota.js").read_text(encoding="utf-8"))
    meta = dict(info, version=version, pkg=f"doom-{tag}.fwsc", data2=f"doom-{tag}.dat")
    for mark in ("/*LIB*/", "/*META*/"):
        if html.count(mark) != 1:
            raise SystemExit(f"installer.html must contain {mark} once")
    html = html.replace("/*LIB*/", lib).replace("/*META*/", json.dumps(meta))
    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("doom-*.fwsc")) + list(out.glob("doom-*.dat")):
        old.unlink()
    (out / "index.html").write_text(html, encoding="utf-8")
    shutil.copy(pkg, out / meta["pkg"])
    shutil.copy(dat, out / meta["data2"])
    print(f"installer: {out}: index.html ({len(html)} B), {meta['pkg']} ({pkg.stat().st_size} B), {meta['data2']} ({dat.stat().st_size} B); "
          f"product {info['product']}, build {info['build']:08x}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
