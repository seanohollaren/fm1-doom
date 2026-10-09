#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""FM-1 Doom: make installable packages from firmware/build/doom.elf's sections and a game data file (.whx).
Uses Felucca's package tools unchanged (./Felucca/tools, GPL-3.0-only, (C) 2026 Leo Kuroshita).

  firmware/pack.py [DATA.whx]

Every package keeps Felucca's exact flash layout (the fixed 581,564-byte app slot, the SDK config files behind it):
the boot code sees nothing it has not already booted on real FM-1s. Three packages, one per step:

  doom_code.fwsc    the firmware alone. Felucca's own loader, unmodified. On the device: safe mode, blue screen.
  doom_part1.fwsc   firmware + a 64-byte descriptor + the first block of the game data, all inside the app slot.
                    Felucca's own loader, unmodified. Nothing above 0x93000 is written. On the device: safe mode,
                    blue screen with two white corners ("second block missing").
  doom_full.fwsc    the same app area, plus the second block of the game data at 0x93000 (stored plain, as all
                    flash from there up reads). Carries a VARIANT of Felucca's loader that also writes
                    [0x93000, 0xE0000) when the package is that long, and behaves exactly as Felucca's for any
                    ordinary package. This is the only step that writes where Felucca / the stock firmware keep
                    their own data, and the only one that runs loader code Felucca has not shipped.

The game data is one file, stored as two blocks because no single run of flash is long enough: the app slot ends
at the config files, and the update staging area starts at 0xE0000. The split is on a lump boundary; the engine
turns offsets into pointers in exactly one function (w_wad.h lump_data), which knows about the two blocks.

Checks before anything is written out: the two blocks read back (through a simulated decrypt) to the original
file; the descriptor's checksums are the ones the firmware will compute; no 4 KB boundary in the data region looks
like an update record to the boot code. NOTHING HERE HAS RUN ON HARDWARE.
"""
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEL = ROOT / "Felucca"
OUT = ROOT / "firmware" / "build"
sys.path.insert(0, str(FEL / "tools"))
import build as fb          # noqa: E402  (Felucca's build.py: toolchain runner, loader wrapper)
import fm1pkg_make as pk    # noqa: E402

APP_XIP = 0x02000120
APP_AREA_END = 0x93000      # Felucca's loader writes [0x4000, 0x93000); flash from here up reads unencrypted
DATA_END = 0xE0000          # the update staging area (and Felucca's update record) start here
DESC_LEN = 64


def sym(name):
    for ln in (OUT / "doom.syms").read_text().splitlines():
        p = ln.split()
        if p and p[-1] == name:
            return int(p[0], 16)
    raise SystemExit(f"pack: no symbol {name}")


def app_image():
    """the firmware image: .text, then .ram_text and .data at their load addresses (as Felucca's build.py)"""
    img = bytearray((OUT / "text.bin").read_bytes())
    for sect, lname in (("ram_text.bin", "_rt_load"), ("data.bin", "_data_load")):
        blob = (OUT / sect).read_bytes()
        load = sym(lname) - APP_XIP
        if load < len(img):
            raise SystemExit(f"pack: {lname} overlaps the image")
        img += b"\xff" * (load - len(img)) + blob
    if sym("_start") != APP_XIP or img[:4] != bytes.fromhex("04818000"):
        raise SystemExit("pack: the image does not start with the entry stub at 0x02000120")
    # the start-up code copies .data word by word from _data_load to _data_start.._data_end: the file must be exactly that
    if len((OUT / "data.bin").read_bytes()) != sym("_data_end") - sym("_data_start") or \
            len((OUT / "ram_text.bin").read_bytes()) != sym("_rt_end") - sym("_rt_start"):
        raise SystemExit("pack: .data / .ram_text in the image are not the size the start-up code copies")
    desc_at = sym("_desc_load") - APP_XIP
    if desc_at < len(img) or sym("_desc_load") % 4:
        raise SystemExit("pack: the data descriptor would overlap the image")
    return bytes(img), desc_at


def split_point(whx, room):
    """the largest lump boundary that leaves block 1 no longer than room"""
    if whx[:4] != b"IWHX":
        raise SystemExit("pack: not a WHX file")
    n, table = struct.unpack_from("<ii", whx, 4)
    offs = sorted({struct.unpack_from("<I", whx, table + 4 * i)[0] & 0xFFFFFF for i in range(n + 1)})
    if offs[-1] > len(whx) or table + 4 * (n + 1) > offs[0]:
        raise SystemExit("pack: unexpected WHX directory")
    if len(whx) <= room:
        return len(whx)
    fit = [o for o in offs if o <= room]
    if not fit or fit[-1] <= table + 4 * (n + 1):
        raise SystemExit("pack: no room for even the data file's directory in the app slot")
    return fit[-1]


def descriptor(whx, split):
    d = struct.pack("<4sIIIIII", b"FM1D", 1, len(whx), split, pk.crc16(whx[:split]), APP_AREA_END, pk.crc16(whx[split:]))
    d += bytes(60 - len(d))
    return d + struct.pack("<I", pk.crc16(d))


def doom_loader():
    """Felucca's loader, able to write the data region too when the package is long enough for it"""
    d = FEL / "build" / "doomldr"
    d.mkdir(parents=True, exist_ok=True)

    def patched(src, repl):
        s = src.read_text()
        for a, b in repl:
            if s.count(a) != 1:
                raise SystemExit(f"pack: {src.name}: expected exactly one {a!r} (Felucca changed? review the loader patch)")
            s = s.replace(a, b)
        return "/* GENERATED by fm1-doom firmware/pack.py from Felucca's " + src.name + ": do not edit */\n" + s
    (d / "ldr_core.c").write_text(patched(FEL / "firmware/loader/ldr_core.c", [
        ("#define LDR_APP_HI 0x93000u",
         "static uint32_t ldr_app_hi = 0x93000u;   /* fm1-doom: 0xE0000 for a package that long (ldr_session), else as Felucca */\n"
         "#define LDR_APP_HI ldr_app_hi"),
        ("#define LDR_NSEC ((LDR_APP_HI - LDR_APP_LO) >> 12)",
         "#define LDR_NSEC ((0xE0000u - LDR_APP_LO) >> 12)   /* fm1-doom: room for the longer window */"),
        ("#define LDR_DATA_LO 0x97000u",
         "#define LDR_DATA_LO (ldr_app_hi > 0x93000u ? 0x93000u : 0x97000u)   /* fm1-doom: no record clean-up in data just written */"),
        ("    if (!fl_off || fl_size < LDR_APP_HI || fl_size > LDR_FL_MAX)",
         "    ldr_app_hi = fl_size >= 0xE0000u ? 0xE0000u : 0x93000u;   /* fm1-doom: an ordinary package is handled exactly as before */\n"
         "    if (!fl_off || fl_size < LDR_APP_HI || fl_size > LDR_FL_MAX)"),
    ]))
    (d / "loader.c").write_text(patched(FEL / "firmware/loader/loader.c", [
        ("#define FL_RANGE_OK(off, n) (FL_IN(off, n, 0x4000u, 0x97000u) || FL_IN(off, n, 0xE0000u, 0xFC000u))",
         "#define FL_RANGE_OK(off, n) (FL_IN(off, n, 0x4000u, 0xE0000u) || FL_IN(off, n, 0xE0000u, 0xFC000u))   /* fm1-doom */"),
        ('#include "../src/libc.c"', '#include "../../firmware/src/libc.c"'),
        ('#include "../src/usb.c"', '#include "../../firmware/src/usb.c"'),
        ('#include "../src/ota.c"', '#include "../../firmware/src/ota.c"'),
    ]))
    flags = [*fb.CFLAGS, "-Ifirmware/hal", "-Ifirmware/src"]
    src = FEL / "firmware" / "loader"
    fb.tc_all(("cc", "-c", src / "crt0_ldr.S", "-o", d / "crt0_ldr.o"),
              ("cc", *flags, "-c", d / "loader.c", "-o", d / "loader.o"))
    fb.tc("pi32v2/bin/ld", "--gc-sections", "-e", "_start", "-T", src / "loader.ld", d / "crt0_ldr.o", d / "loader.o", "-o", d / "loader.elf")
    fb.tc("common/bin/objcopy", "-O", "binary", "-j", ".text", d / "loader.elf", d / "loader.bin")
    hdr = fb.tc("common/bin/objdump", "-h", d / "loader.elf")
    for ln in hdr.splitlines():                       # as Felucca's build: the loader rewrites the flash, nothing may run from XIP
        p = ln.split()
        if len(p) > 4 and p[1].startswith(".") and int(p[3], 16) >= 0x02000000 and int(p[2], 16):
            raise SystemExit(f"pack: loader section {p[1]} is outside RAM")
    image = (d / "loader.bin").read_bytes()
    if not image or len(image) > 0x14000 or b"FELUCCA-LOADER-1" not in image[:64]:
        raise SystemExit("pack: loader image empty, too big, or without its tag")
    return fb.ldr_wrap(image)


def record_lookalikes(flash):
    """the boot code (and the loaders) look for an update record at each 4 KB boundary - 256 from 0x93000 up"""
    hits = []
    for s in range(APP_AREA_END + 0x1000, 0xFC000 + 1, 0x1000):
        r = flash[s - 0x100:s - 0x100 + 80]
        if len(r) == 80 and struct.unpack_from("<H", r, 6)[0] == 0x5441:
            c = struct.unpack_from("<H", r, 0)[0]
            if c and c == pk.crc16(r[2:80]):
                hits.append(s - 0x100)
    return hits


def main():
    if len(sys.argv) > 2:
        raise SystemExit(__doc__)
    img, desc_at = app_image()
    felucca_ota = (FEL / "build" / "loader" / "ota.bin").read_bytes()      # as Felucca's own build made it
    core = (OUT / "core.id").read_text().strip() if (OUT / "core.id").exists() else "?"

    # 1. the firmware alone
    flash = pk.flash_image(img, pk.KEY)
    (OUT / "doom.bin").write_bytes(img)
    (OUT / "doom_code.fwsc").write_bytes(pk.ufw(flash, felucca_ota, "FM-1_900"))
    print(f"firmware {len(img)} B, recovery core id {core}")
    print(f"doom_code.fwsc   {len(pk.ufw(flash, felucca_ota, 'FM-1_900'))} B   Felucca layout, Felucca loader ({len(felucca_ota)} B), no data")
    if len(sys.argv) < 2:
        return

    # 2. + descriptor and block 1 inside the app slot
    whx = Path(sys.argv[1]).read_bytes()
    room = pk.APP_SLOT - (desc_at + DESC_LEN)
    split = split_point(whx, room)
    desc = descriptor(whx, split)
    app = img + b"\xff" * (desc_at - len(img)) + desc + whx[:split]
    assert len(app) <= pk.APP_SLOT
    block2 = whx[split:]
    if APP_AREA_END + len(block2) > DATA_END:
        raise SystemExit(f"pack: the second block ({len(block2)} B) ends {APP_AREA_END + len(block2) - DATA_END} B past {DATA_END:#x}")
    flash1 = pk.flash_image(app, pk.KEY)                                    # Felucca's layout, Felucca's packer
    assert len(flash1) == APP_AREA_END

    # 3. + block 2 above the app area, padded to the length the loader variant takes as "write the data region too"
    flash2 = bytearray(flash1 + b"\xff" * (DATA_END - APP_AREA_END))
    flash2[APP_AREA_END:APP_AREA_END + len(block2)] = block2
    flash2 = bytes(flash2)

    # checks
    back = bytearray(flash2)                                                # what the CPU reads: decrypted below 0x93000
    pk.sfc(back, 0x4000, APP_AREA_END - 0x4000, 0x4000, pk.KEY)
    at = 0x4000 + 0x120 + desc_at                                           # app.bin starts 0x120 into the app area
    got_desc = bytes(back[at:at + DESC_LEN])
    b1 = bytes(back[at + DESC_LEN:at + DESC_LEN + split])
    b2 = bytes(back[APP_AREA_END:APP_AREA_END + len(block2)])
    if got_desc != desc or b1 + b2 != whx:
        raise SystemExit("pack: the data does not read back")
    if struct.unpack_from("<I", desc, 16)[0] != pk.crc16(b1) or struct.unpack_from("<I", desc, 24)[0] != pk.crc16(b2):
        raise SystemExit("pack: descriptor checksums")
    hits = record_lookalikes(flash2)
    if hits:
        raise SystemExit(f"pack: game data looks like an update record at {[hex(h) for h in hits]}: change the data")
    if flash2[:APP_AREA_END] != flash1:
        raise SystemExit("pack: the two packages' app areas differ")
    print(f"  ok    descriptor at XIP {APP_XIP + desc_at:#x}; block 1 {split} B in the app slot ({room - split} B spare); "
          f"block 2 {len(block2)} B at {APP_AREA_END:#x} ({DATA_END - APP_AREA_END - len(block2)} B spare)")
    print("  ok    both blocks read back to the original file; checksums as the firmware computes them")
    print("  ok    no 4 KB boundary in the data region looks like an update record")
    ext_ota = doom_loader()
    p1, p2 = pk.ufw(flash1, felucca_ota, "FM-1_900"), pk.ufw(flash2, ext_ota, "FM-1_900")
    (OUT / "doom_part1.fwsc").write_bytes(p1)
    (OUT / "doom_full.fwsc").write_bytes(p2)
    print(f"doom_part1.fwsc  {len(p1)} B   Felucca layout, Felucca loader, data block 1; writes nothing above {APP_AREA_END:#x}")
    print(f"doom_full.fwsc   {len(p2)} B   the same app area + data block 2; loader variant ({len(ext_ota)} B)")
    print("NOT TESTED ON HARDWARE - do not install without review")


if __name__ == "__main__":
    main()
