#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Make the installer site from the last firmware/pack.py run and the last web/build_whdgen.sh run:

  web/make_installer.py VERSION OUT_DIR [--source URL] [--wad-help URL] [--bundle "LABEL=FILE.whx[=NOTE]"]...

  OUT_DIR/index.html         web/installer.html with the scripts and the build's numbers inlined
  OUT_DIR/doom-VERSION.fwsc  the firmware alone (firmware/build/doom_code.fwsc; Felucca's unmodified loader)
  OUT_DIR/whd_gen.js, .wasm  rp2040-doom's data converter for the browser
  OUT_DIR/LICENSES/          the licence texts that travel with the firmware file and the converter

The site holds NO game data: the visitor picks their own Doom WAD and the page cuts and converts it in the
browser. --source is the public address of the source code (the GPL asks for it once the site is public).

--bundle adds a button that installs an already converted data file, copied into the site. That is for data you
may host (a free level), or for a private test site: data cut from DOOM1.WAD must not be published.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "firmware" / "build"
WHDGEN = ROOT / "web" / "build" / "whdgen"
FEL = ROOT / "Felucca"
# (source, name in LICENSES/, what it covers)
LICENCES = [
    (FEL / "LICENSE", "GPL-3.0.txt", "the firmware as a whole; Felucca's hardware layer, update loader and update protocol code"),
    (ROOT / "rp2040-doom" / "COPYING.md", "GPL-2.0.txt", "the Doom engine (Chocolate Doom, rp2040-doom), GPL-2.0-or-later"),
    (FEL / "LICENSES" / "Apache-2.0.txt", "Apache-2.0.txt", "three JieLi AC79 SDK files inside the firmware file"),
    (ROOT / "rp2040-doom" / "src" / "adpcm-xq" / "license.txt", "BSD-3-Clause-adpcm-xq.txt", "the sound encoder inside the data converter"),
]
WEB = ROOT / "web"
SCRIPTS = [WEB / "vendor" / "felucca" / "fm1pkg.js", WEB / "vendor" / "felucca" / "fm1ota.js", WEB / "wadcut.js", WEB / "datapack.js", WEB / "convert.js",
           WEB / "install.js"]


def strip_module(src):                      # as Felucca's web/make_site.py
    src = re.sub(r"^export\s+", "", src, flags=re.M)
    return re.sub(r"^import .*?;\n", "", src, flags=re.M)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version")
    ap.add_argument("out", type=Path)
    ap.add_argument("--source", default="")
    ap.add_argument("--bundle", action="append", default=[])
    ap.add_argument("--wad-help", default="", help="the 'about the file' link next to the file chooser (default: the Doom Wiki's DOOM1.WAD page)")
    a = ap.parse_args()
    out = a.out
    info = json.loads((BUILD / "doom_install.json").read_text())
    pkg = (BUILD / "doom_code.fwsc").read_bytes()
    for k in ("img_len", "desc_at", "app_slot"):
        if k not in info:
            raise SystemExit("make_installer: doom_install.json is from an older firmware/pack.py; run it again")
    for f in ("whd_gen.js", "whd_gen.wasm"):
        if not (WHDGEN / f).exists():
            raise SystemExit("make_installer: no data converter; run web/build_whdgen.sh")
    tag = re.sub(r"[^A-Za-z0-9.-]", "-", a.version)
    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("doom-*.fwsc")) + list(out.glob("doom-*.dat")) + list(out.glob("*.whx")):
        old.unlink()
    bundled = []
    for i, b in enumerate(a.bundle):
        label, src, *note = b.split("=", 2)
        whx = Path(src).read_bytes()
        if whx[:4] != b"IWHX":
            raise SystemExit(f"make_installer: {src} is not a .whx file")
        name = f"data-{i}.whx"
        (out / name).write_bytes(whx)
        bundled.append({"label": label, "file": name, "note": note[0] if note else ""})
    fw = {k: info[k] for k in ("product", "build", "core", "img_len", "desc_at", "app_slot")}
    meta = {"version": a.version, "fw": fw, "pkg": f"doom-{tag}.fwsc", "pkg_sha256": hashlib.sha256(pkg).hexdigest(),
            "whdgen": "whd_gen.js", "bundled": bundled, "source": a.source, "wad_help": a.wad_help}
    html = (ROOT / "web" / "installer.html").read_text(encoding="utf-8")
    lib = "\n".join(strip_module(p.read_text(encoding="utf-8")) for p in SCRIPTS)
    for mark in ("/*LIB*/", "/*META*/"):
        if html.count(mark) != 1:
            raise SystemExit(f"installer.html must contain {mark} once")
    html = html.replace("/*LIB*/", lib).replace("/*META*/", json.dumps(meta))
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / meta["pkg"]).write_bytes(pkg)
    for f in ("whd_gen.js", "whd_gen.wasm"):
        shutil.copy(WHDGEN / f, out / f)
    lic = out / "LICENSES"
    lic.mkdir(exist_ok=True)
    for src, name, _ in LICENCES:
        shutil.copy(src, lic / name)
    (lic / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Doom for the FM-1: licences</title><h1>Licence texts</h1><ul>'
        + "".join(f'<li><a href="{name}">{name}</a>: {what}</li>' for _, name, what in LICENCES)
        + '</ul><p><a href="../">Back to the installer</a></p>\n', encoding="utf-8")
    print(f"installer: {out}: index.html ({len(html)} B), {meta['pkg']} ({len(pkg)} B, firmware only), whd_gen.wasm "
          f"({(WHDGEN / 'whd_gen.wasm').stat().st_size} B); product {info['product']}, build {info['build']:08x}")
    if bundled:
        print("  CONTAINS GAME DATA (" + ", ".join(b["label"] for b in bundled) + "): publish only if that data may be hosted")
    if not a.source:
        print("  no --source: fine for a local test; a public site must say where the source code is")


if __name__ == "__main__":
    main()
