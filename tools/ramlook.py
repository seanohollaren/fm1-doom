#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""ramlook.py RAM.bin [BUILD_DIR]: read a RAM snapshot taken with `fm1boot.py ramdump` using the symbols of
the firmware that was running (default BUILD_DIR: firmware/installed_e58934d4). Mac only; nothing here talks
to the device.

Prints the boot guard, the crash record (with the function each address falls in), the game / video state,
and writes what the two 8-bit frame buffers and the LCD strip buffers held as PNG files next to the dump.
"""
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 0x01C00000


def load_syms(path):
    syms, funcs = {}, []
    for ln in path.read_text().splitlines():
        p = ln.split()
        if len(p) < 4:
            continue
        try:
            addr, size = int(p[0], 16), int(p[-2], 16)
        except ValueError:
            continue
        name = p[-1]
        if name.startswith("."):
            continue
        syms.setdefault(name, (addr, size))
        if 0x02000000 <= addr < 0x02100000 or 0x01C00000 <= addr < 0x01C01000:
            funcs.append((addr, name))
    funcs.sort()
    return syms, funcs


def where(funcs, addr):
    lo, hi = 0, len(funcs)
    while lo < hi:
        mid = (lo + hi) // 2
        if funcs[mid][0] <= addr:
            lo = mid + 1
        else:
            hi = mid
    if not lo:
        return "?"
    a, n = funcs[lo - 1]
    return f"{n}+0x{addr - a:X}" if addr - a < 0x4000 else "? (not in the image)"


def png(path, w, h, rgb):
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(b"\x00" + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def rgb565(v):
    return bytes(((v >> 11) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    dump = Path(argv[1])
    ram = dump.read_bytes()
    build = Path(argv[2]) if len(argv) > 2 else ROOT / "firmware" / "installed_e58934d4"
    syms, funcs = load_syms(build / "doom.syms")
    print(f"{dump.name}: {len(ram)} B; symbols from {build.name} (core id {(build / 'core.id').read_text().strip()})")

    def mem(addr, n):
        return ram[addr - BASE:addr - BASE + n]

    def val(name, signed=False):
        if name not in syms:
            return None
        addr, size = syms[name]
        size = size if size in (1, 2, 4) else 4
        return int.from_bytes(mem(addr, size), "little", signed=signed)

    # --- is this a believable snapshot of that firmware?
    rt = build / "ram_text.bin"
    if rt.exists():
        blob = rt.read_bytes()
        same = mem(BASE, len(blob)) == blob
        print(f"  RAM-resident code at 0x01C00000 {'matches the build' if same else 'DIFFERS from the build'} ({len(blob)} B)")
    data = build / "data.bin"
    if data.exists() and "_data_start" in syms:
        print(f"  .data region differs from its initial values in "
              f"{sum(a != b for a, b in zip(mem(syms['_data_start'][0], len(data.read_bytes())), data.read_bytes()))} "
              f"of {len(data.read_bytes())} bytes (variables change; a few hundred is normal)")
    print(f"  boot ROM mailbox: {mem(0x01C7FD50, 0x40).split(bytes(1))[0][:20]!r} ...")

    # --- boot guard and crash record
    bg = struct.unpack("<III", mem(syms["bootguard"][0], 12))
    print(f"boot guard: magic {bg[0]:08X} ({'ok' if bg[0] == 0x42475244 else 'not set'}), failed {bg[1]}, pending {bg[2]}")
    c = struct.unpack("<16I", mem(syms["fm1_crash"][0], 64))
    names = ["magic", "count", "vec", "pc", "rets", "emu", "dbg", "sp", "psr", "icfg", "uptime_ms"]
    print("crash record: " + ", ".join(f"{n} {v:08X}" if n not in ("count", "uptime_ms") else f"{n} {v}"
                                         for n, v in zip(names, c)))
    print(f"              etm {' '.join(f'{v:08X}' for v in c[11:15])}, early {c[15]}")
    if c[1]:
        print(f"  pc   {c[3]:08X} = {where(funcs, c[3])}")
        print(f"  rets {c[4]:08X} = {where(funcs, c[4])}")
        for i, v in enumerate(c[11:15]):
            if 0x02000000 <= v < 0x02100000 or 0x01C00000 <= v < 0x01C01000:
                print(f"  etm{i} {v:08X} = {where(funcs, v)}")
        sp = c[7]
        if BASE <= sp < BASE + len(ram) - 64:
            words = struct.unpack("<24I", mem(sp, 96))
            print(f"  stack at sp {sp:08X}:")
            for i, w in enumerate(words):
                if 0x02000120 <= w < 0x02040000:
                    print(f"    [sp+{i * 4:3d}] {w:08X} = {where(funcs, w)}")
        for nm in ("_guard0", "_ustack_lo", "_ustack_top", "_guard1", "_sstack_lo", "_sstack_top"):
            if nm in syms:
                print(f"    {nm} {syms[nm][0]:08X}", end="")
        print()

    # --- state
    print("state:")
    for nm in ("fm1_ms", "dev_mode", "dev_host_seen", "fm1_frames", "gamestate", "oldgamestate", "wipegamestate",
               "gameaction", "gametic", "leveltime", "menuactive", "usergame", "paused", "inhelpscreens",
               "screenvisible", "nodrawers", "initialized", "display_video_type", "next_video_type",
               "display_frame_index", "next_frame_index", "render_frame_index", "display_overlay_index",
               "next_overlay_index", "wipestate", "wipe_min", "pre_wipe_state", "fm1_strip_i", "fm1_other_busy",
               "vpatchlists", "mainzone", "fm1_underruns", "lcd_busy"):
        v = val(nm)
        if v is not None:
            print(f"  {nm:22s} {v:#x} ({v})")
    for nm in ("render_frame_ready", "display_frame_freed"):
        if nm in syms:
            raw = mem(syms[nm][0], 8)
            print(f"  {nm:22s} raw {raw.hex(' ')}  (int16 pairs: {struct.unpack('<4h', raw)})")
    if "scanline_funcs" in syms:
        fns = struct.unpack("<6I", mem(syms["scanline_funcs"][0], 24))
        print("  scanline_funcs         " + ", ".join(f"{f:08X}={where(funcs, f)}" if f else "0" for f in fns))

    # --- pictures
    out = dump.with_suffix("")
    if "palette" in syms and "frame_buffer" in syms:
        pal = struct.unpack("<256H", mem(syms["palette"][0], 512))
        fb_addr, fb_size = syms["frame_buffer"]
        w, h = 320, fb_size // 2 // 320
        print(f"palette: {len(set(pal))} distinct colours, first {pal[0]:04X} {pal[1]:04X} {pal[2]:04X} {pal[3]:04X}")
        for i in range(2):
            fb = mem(fb_addr + i * w * h, w * h)
            png(Path(f"{out}-frame{i}.png"), w, h, b"".join(rgb565(pal[b]) for b in fb))
            print(f"  frame buffer {i}: {len(set(fb))} distinct pixel values -> {out.name}-frame{i}.png")
    if "fm1_strips" in syms:
        a, size = syms["fm1_strips"]
        px = struct.unpack(f">{size // 2}H", mem(a, size))           # byte-swapped for the panel
        png(Path(f"{out}-strips.png"), 240, size // 2 // 240, b"".join(rgb565(v) for v in px))
        print(f"  LCD strip buffers (the last lines handed to the screen) -> {out.name}-strips.png")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
