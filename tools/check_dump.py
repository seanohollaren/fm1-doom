#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""check_dump.py DUMP.bin [PACKAGE.fwsc ...]: is a 1 MiB flash dump from tools/fm1boot.py a sound image?

Reads only files on the Mac. It walks the flash header the way the boot code does (Felucca's
tools/fm1pkg_make.py describes the layout), checks every checksum it finds, derives the chip key from the
image itself, decrypts the application area with it, and compares the dump with the flash images inside the
given packages (head [0, 0x4000) and application area [0x4000, 0x93000)).
"""
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Felucca" / "tools"))
import fm1pkg_make as pk                    # noqa: E402  (Felucca's own packer: crc16, enc, sfc, chipkey_decode)

APP_LO, APP_HI, SIZE = 0x4000, 0x93000, 1 << 20
ok = True


def check(name, cond, detail=""):
    global ok
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{(' - ' + detail) if detail else ''}")
    ok &= bool(cond)


def dec32(buf):
    b = bytearray(buf)
    for o in range(0, len(b), 32):
        pk.enc(b, o, min(32, len(b) - o))
    return bytes(b)


def parse_entry(e):
    hcrc, dcrc, off, size, flags, resvd, index, name = struct.unpack("<HHIIBBH16s", e)
    return {"hcrc_ok": pk.crc16(e[2:]) == hcrc, "dcrc": dcrc, "off": off, "size": size, "flags": flags,
            "name": name.split(b"\0")[0].decode("latin1")}


def flash_of_package(path):
    """the flash image inside a .fwsc (Felucca tools/fm1_install.py logical_image + the UFW entry list)"""
    raw = Path(path).read_bytes()
    logical = bytearray()
    for i in range(20):
        logical += raw[i * 0x30:i * 0x30 + 0x2F]
    logical += raw[20 * 0x30:]
    hdr = bytearray(logical[:0x40])
    pk.enc(hdr, 0, 0x40)
    n = struct.unpack_from("<H", hdr, 8)[0]
    for i in range(n):
        e = bytearray(logical[0x40 + i * 0x50:0x90 + i * 0x50])
        pk.enc(e, 0, 0x50)
        typ, _, crc, _, off, size, _ = struct.unpack_from("<HHHHIII", e, 0)
        if typ == 0:
            data = bytes(logical[off:off + size])
            return data if pk.crc16(data) == crc else None
    return None


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    d = Path(argv[1]).read_bytes()
    print(f"{argv[1]}: {len(d)} B")
    check("1 MiB", len(d) == SIZE)
    # ---- head: header + four entries, each ENC-ciphered in 32-byte blocks
    head = dec32(d[:32 * 5])
    check("flash header checksum", struct.unpack("<H", head[:2])[0] == pk.crc16(head[2:32]))
    ents = [parse_entry(head[32 + 32 * i:64 + 32 * i]) for i in range(4)]
    for e in ents:
        check(f"head entry '{e['name']}' checksum", e["hcrc_ok"], f"offset {e['off']:#x}, size {e['size']:#x}")
    spl, isd = ents[0], ents[1]
    # (M-VAVE's packer does not checksum uboot.boot the way Felucca's does, so this one is information only;
    #  the head is judged by comparing it with the head inside a package, below)
    print(f"        uboot.boot checksum by Felucca's formula: "
          f"{'matches' if pk.crc16(d[spl['off']:spl['off'] + spl['size']]) == spl['dcrc'] else 'does not match'}")
    isd_data = d[isd["off"]:isd["off"] + isd["size"]]
    check("isd_config data checksum", pk.crc16(isd_data) == isd["dcrc"])
    key = pk.chipkey_decode(isd_data[:32])
    check("chip key stored in the image", key == 0x980F, f"{key:04X}")
    # ---- app area: SFC-ciphered with the chip key
    a0 = bytearray(d[APP_LO:APP_LO + 32])
    pk.sfc(a0, 0, 32, 0, key)
    ah = parse_entry(bytes(a0))
    check(f"app area head '{ah['name']}' checksum", ah["hcrc_ok"], f"block size {ah['size']:#x}")
    blk = ah["size"]
    if ah["hcrc_ok"] and 0x120 < blk <= APP_HI - APP_LO:
        area = bytearray(d[APP_LO:APP_LO + blk])
        pk.sfc(area, 0, blk, 0, key)
        check("app area data checksum (everything the boot code maps)", pk.crc16(area[32:blk]) == ah["dcrc"])
        for i in range(1, 9):
            e = parse_entry(bytes(area[32 * i:32 * i + 32]))
            if not e["hcrc_ok"]:
                break
            if e["flags"] == 0x82 and e["off"] + e["size"] <= blk:
                body = area[e["off"]:e["off"] + e["size"]]
                check(f"file '{e['name']}' data checksum", pk.crc16(body) == e["dcrc"], f"{e['size']} B")
                if e["name"] == "app.bin":
                    used = len(bytes(body).rstrip(b"\xff"))
                    names = sorted({bytes(body[j:j + 8]).decode() for j in range(len(body) - 8)
                                    if body[j:j + 5] == b"FM-1_" and body[j + 5:j + 8].isdigit()})
                    print(f"        app.bin: {used} B used of {e['size']}; identity strings {names}")
    # ---- the rest of the flash
    def blank(lo, hi):
        return d[lo:hi] == b"\xff" * (hi - lo)
    regions = [(0x93000, 0x97000, "gap below Felucca's store"), (0x97000, 0xE0000, "Felucca's store"),
               (0xE0000, 0xE5000, "update staging and record"), (0xE5000, 0xE7000, "Felucca autosave"),
               (0xE7000, 0xE8000, "Felucca voice bank"), (0xE8000, 0xFC000, "stock firmware's data"),
               (0xFC000, 0x100000, "Felucca settings / key area")]
    for lo, hi, name in regions:
        used = sum(1 for s in range(lo, hi, 0x1000) if not blank(s, s + 0x1000))
        print(f"        {lo:06X}-{hi:06X} {name}: {used} of {(hi - lo) // 0x1000} sectors hold data")
    check("no update record pending (staging area blank)", blank(0xE0000, 0xE5000))
    # ---- against packages
    heads = 0
    for p in argv[2:]:
        f = flash_of_package(p)
        if f is None:
            check(f"{Path(p).name}: readable package", False)
            continue
        same_head = f[:APP_LO] == d[:APP_LO]
        heads += same_head
        same_app = f[APP_LO:APP_HI] == d[APP_LO:APP_LO + len(f) - APP_LO][:APP_HI - APP_LO] and len(f) >= APP_HI
        diff = sum(1 for s in range(APP_LO, APP_HI, 0x1000) if f[s:s + 0x1000] != d[s:s + 0x1000])
        print(f"        vs {Path(p).name}: head [0, 0x4000) {'IDENTICAL' if same_head else 'differs'}; "
              f"app area {'IDENTICAL' if same_app else f'differs in {diff} of 143 sectors'}")
    if argv[2:]:
        check("head [0, 0x4000) is byte-identical to the head inside one of the packages", heads > 0)
    print("DUMP IS A SOUND IMAGE" if ok else "DUMP HAS PROBLEMS")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
