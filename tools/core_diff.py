#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""core_diff.py OLD_DIR NEW_DIR [-v]: did the recovery core change between two firmware builds?

The recovery core is everything that boots the FM-1, chooses safe mode and takes a new firmware over USB: the
start-up code, the vectors, the interrupt stubs and firmware/doom_dev.c with the Felucca sources it includes. A
build whose recovery core is the code of a build that has already run on the device adds no risk below the game.

Each directory holds one build's doom.map and doom.dis (firmware/build, or a kept firmware/installed_* copy).
Functions are compared as instruction text with link addresses masked. Reads files on the Mac only.
"""
import difflib
import re
import sys

OBJECTS = r"firmware/build/obj/(crt0|fm1_vec|fm1_isr|doom_dev)\.o"


def core_ranges(mapfile):
    out = []
    for ln in open(mapfile):
        m = re.match(r"\s*(\.\S+)?\s*0x0*([0-9a-f]+)\s+0x([0-9a-f]+)\s+" + OBJECTS, ln)
        if m and int(m.group(2), 16) >= 0x1C00000 and int(m.group(3), 16):
            out.append((int(m.group(2), 16), int(m.group(2), 16) + int(m.group(3), 16)))
    return out


def functions(d):
    ranges = core_ranges(d + "/doom.map")
    out, name = {}, None
    for ln in open(d + "/doom.dis", errors="replace"):
        m = re.match(r"^([A-Za-z_.$][\w.$]*):\s*$", ln)
        if m:
            name = m.group(1)
            continue
        m = re.match(r"^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*\t(.*)$", ln)
        if not m or name is None or not any(lo <= int(m.group(1), 16) < hi for lo, hi in ranges):
            continue

        def target(mm, name=name):      # a branch inside the function keeps its offset; anything else is "elsewhere"
            s = mm.group(1).split(":")[0].strip()
            return "<" + (s[len(name):] if s == name or s.startswith(name + "+") else "ext") + ">"

        t = re.sub(r"\s*#.*$", "", m.group(3).strip())                     # the disassembler's own remarks
        t = re.sub(r"-?\d+\s*<([^>]*)>", target, t)
        t = re.sub(r"\b(2[89]\d{6}|3[0-4]\d{6})\b", "ADDR", t)             # bare RAM and flash addresses
        out.setdefault(name, []).append(t)
    return out, sum(hi - lo for lo, hi in ranges)


def main(old, new, verbose):
    a, size_a = functions(old)
    b, size_b = functions(new)
    print(f"recovery core: {size_a} B in {len(a)} functions -> {size_b} B in {len(b)} functions")
    same = [f for f in a if f in b and a[f] == b[f]]
    moved, changed = [], []
    for f in (f for f in a if f in b and a[f] != b[f]):
        shifts, other = set(), len(a[f]) != len(b[f])
        for p, q in zip(a[f], b[f]):
            if p == q or other:
                continue
            n, k = re.findall(r"-?\d+", p), re.findall(r"-?\d+", q)
            if re.sub(r"-?\d+", "N", p) != re.sub(r"-?\d+", "N", q):
                other = True
            shifts |= {int(v) - int(u) for u, v in zip(n, k) if u != v}
        (changed if other else moved).append((f, sorted(shifts)))
    print(f"  the same instructions: {len(same)}")
    print(f"  the same instructions, variables at other offsets: {len(moved)}")
    for f, s in moved:
        print(f"      {f}: offsets moved by {s}")
    print(f"  DIFFERENT CODE: {len(changed)}")
    for f, _ in changed:
        print(f"      {f}: {len(a[f])} -> {len(b[f])} instructions")
        if verbose:
            for ln in difflib.unified_diff(a[f], b[f], lineterm="", n=0):
                if not ln.startswith(("---", "+++", "@@")):
                    print("          " + ln)
    print(f"  only in the old build: {sorted(set(a) - set(b)) or 'none'}")
    print(f"  only in the new build: {sorted(set(b) - set(a)) or 'none'}")


if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if x != "-v"]
    if len(args) != 2:
        raise SystemExit(__doc__)
    main(args[0], args[1], "-v" in sys.argv)
